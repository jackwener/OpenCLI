/**
 * xiaoyuzhou upload — create an episode (单集) on the Xiaoyuzhou podcaster backend.
 *
 * There is no public "upload audio" API for podcasters: an episode is created
 * through the 创建单集 form of podcaster.xiaoyuzhoufm.com. That form is driven
 * from inside the page:
 *
 *   1. the audio picker is a hidden react-dropzone `<input type="file">` that
 *      lives in the "上传播客" modal. The page's own uploader then pushes the
 *      bytes to Qiniu with the podcaster's upload token
 *      (balloon.xiaoyuzhoufm.com/qiniu/provision), so the opencli process never
 *      has to speak the Qiniu protocol;
 *   2. the file is attached with a synthetic `DataTransfer` + `change` event,
 *      which is exactly what react-dropzone listens for;
 *   3. the local file is served over a short-lived loopback HTTP server, so the
 *      browser reads it straight from disk (no base64 round trip, no size cap).
 *
 * Draft vs publish: creating an episode (POST /v1/episode/hosted/create-free)
 * only produces an unpublished draft (status INITIALIZED, shown as 单集审核中 in
 * the backend). Publishing is a separate call (POST /v1/episode/hosted/publish)
 * and is only made when the caller explicitly asks for it.
 *
 * The podcaster UI is a Mantine app: its modal content is mounted from a
 * requestAnimationFrame driven transition, so the page has to be *visible*.
 * A backgrounded Chrome window would leave the upload modal empty forever, so
 * the adapter checks `document.visibilityState` and fails with a clear hint
 * instead of hanging.
 *
 * Usage:
 *   opencli xiaoyuzhou upload ./episode.m4a --title "标题" --description "简介"
 *   opencli xiaoyuzhou upload ./episode.m4a --title "标题" --description "简介" --draft
 *   opencli xiaoyuzhou upload ./episode.m4a --title "标题" --description "简介" --publish
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

const SITE = 'xiaoyuzhou';
const PODCASTER_HOST = 'podcaster.xiaoyuzhoufm.com';
const PODCASTER_ORIGIN = `https://${PODCASTER_HOST}`;
const PODCASTER_API = 'https://podcaster-api.xiaoyuzhoufm.com';
const PUBLIC_ORIGIN = 'https://www.xiaoyuzhoufm.com';
// 节目 id 不内置默认值:由 --podcast 或环境变量 YT2PODCAST_PODCAST_ID 提供。
const DEFAULT_PODCAST_ID = process.env.YT2PODCAST_PODCAST_ID || '';

const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_POLL_SECONDS = 1;
/** How long to wait for the page to become visible before giving up. */
const VISIBILITY_GRACE_SECONDS = 20;

/**
 * Page structure constants — keep them here so a Xiaoyuzhou UI change only
 * needs one edit. Selectors avoid user-visible text wherever possible; the
 * few text-based fallbacks list several locales.
 */
const SELECTORS = {
    /** Title field of the episode form. */
    titleInput: 'input[name="title"]',
    /** Shownotes (简介) rich text editor. */
    shownotesEditor: 'div[contenteditable="true"]',
    /** "本音频为 AI 生成" switch (data-sentry-source-file is stable, the label is not). */
    aiGeneratedSwitch: '[data-sentry-source-file="EpisodeAISettingSection.tsx"] input[role="switch"]',
    /** Link to the creator service agreement; the checkbox sits next to it. */
    agreementLink: 'a[href*="post.xiaoyuzhoufm.com/podcaster"]',
    /** Submit button of the episode form. */
    submitButton: 'button[type="submit"]',
    /** react-dropzone input that accepts audio files (cover inputs accept images). */
    audioFileInput: 'input[type="file"][accept*="audio/"]',
    /** Cover picker input (inside the `image` field group). */
    coverFileInput: 'div[name="image"] input[type="file"]',
    /** Upload placeholder ("点击上传 播客"). The cover one lives in div[name=image]. */
    uploadPlaceholder: '[data-sentry-component="Placeholder"]',
};

const AUDIO_MIME_BY_EXT = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/x-m4a',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
};

const IMAGE_MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
};

export function inferMimeType(filePath, table, fallback) {
    const ext = path.extname(filePath).toLowerCase();
    return table[ext] || fallback;
}

export function requirePositiveInt(value, label, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const num = Number(value);
    if (!Number.isInteger(num) || num <= 0) {
        throw new ArgumentError(`--${label} must be a positive integer (got "${value}")`);
    }
    return num;
}

export function buildCreateUrl(podcastId) {
    return `${PODCASTER_ORIGIN}/podcast/${podcastId}/episode/create`;
}

export function buildEpisodeUrl(eid) {
    return `${PUBLIC_ORIGIN}/episode/${eid}`;
}

/** The podcaster API answers 401 with this shape when the session is gone. */
export function isAuthFailure(payload) {
    if (!payload || typeof payload !== 'object') {
        return false;
    }
    const code = Number(payload.code);
    return code === 401 || code === 403;
}

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

async function evaluate(page, script) {
    const raw = unwrapEvaluateResult(await page.evaluate(script));
    if (raw && typeof raw === 'object' && raw.__error) {
        throw new CommandExecutionError(`Xiaoyuzhou page script failed: ${raw.__error}`);
    }
    return raw;
}

async function sleep(page, seconds) {
    if (typeof page.sleep === 'function') {
        await page.sleep(seconds);
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Serve the given local files over loopback so the page can fetch them.
 * Files are addressed as /file/<index>.
 */
export function startFileServer(files) {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const headers = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Private-Network': 'true',
                'Access-Control-Allow-Methods': 'GET,OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Cache-Control': 'no-store',
            };
            if (req.method === 'OPTIONS') {
                res.writeHead(204, headers);
                res.end();
                return;
            }
            const match = /^\/file\/(\d+)/.exec(String(req.url || '').split('?')[0]);
            const index = match ? Number(match[1]) : -1;
            const file = files[index];
            if (!file) {
                res.writeHead(404, headers);
                res.end('not found');
                return;
            }
            let stat;
            try {
                stat = fs.statSync(file.path);
            }
            catch (error) {
                res.writeHead(500, headers);
                res.end(String(error?.message || error));
                return;
            }
            if (!stat.isFile()) {
                res.writeHead(404, headers);
                res.end('not a file');
                return;
            }
            res.writeHead(200, { ...headers, 'Content-Type': file.mimeType, 'Content-Length': stat.size });
            const stream = fs.createReadStream(file.path);
            stream.on('error', () => {
                try {
                    res.end();
                }
                catch {
                    // The response is already gone; nothing to clean up.
                }
            });
            stream.pipe(res);
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({ server, port: typeof address === 'object' && address ? address.port : 0 });
        });
    });
}

function stopFileServer(handle) {
    return new Promise((resolve) => {
        if (!handle || !handle.server) {
            resolve();
            return;
        }
        handle.server.closeAllConnections?.();
        handle.server.close(() => resolve());
    });
}

/**
 * Call the podcaster API from the page context so the browser attaches the
 * session cookie and the correct Origin.
 */
export async function apiFetch(page, endpoint, { method = 'GET', body, podcastId } = {}) {
    const script = `(async () => {
      try {
        const token = (document.cookie.match(/x-jike-access-token=([^;]+)/) || [])[1] || '';
        const headers = {
          'Content-Type': 'application/json',
          'x-jike-allow-app-token-in-cookie': 'true',
        };
        if (token) headers['x-jike-access-token'] = token;
        ${podcastId ? `headers['x-pid'] = ${JSON.stringify(podcastId)};` : ''}
        const response = await fetch(${JSON.stringify(PODCASTER_API + endpoint)}, {
          method: ${JSON.stringify(method)},
          headers,
          credentials: 'include',
          body: ${body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(body))},
        });
        const text = await response.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (error) { parsed = { __raw: text.slice(0, 400) }; }
        return { ok: response.ok, httpStatus: response.status, body: parsed };
      } catch (error) {
        return { ok: false, httpStatus: 0, body: null, error: String((error && error.message) || error) };
      }
    })()`;
    const result = await evaluate(page, script);
    if (!result || typeof result !== 'object') {
        throw new CommandExecutionError('Xiaoyuzhou API call returned no result');
    }
    if (result.error) {
        throw new CommandExecutionError(`Xiaoyuzhou API call failed: ${result.error}`);
    }
    const payload = result.body;
    if (!result.ok || isAuthFailure(payload)) {
        if (result.httpStatus === 401 || result.httpStatus === 403 || isAuthFailure(payload)) {
            throw new AuthRequiredError(
                PODCASTER_HOST,
                `Xiaoyuzhou podcaster session is not valid (HTTP ${result.httpStatus})`,
                `Open https://${PODCASTER_HOST}/ in Chrome, sign in to the podcaster backend, then retry.`,
            );
        }
        throw new CommandExecutionError(
            `Xiaoyuzhou API ${endpoint} failed with HTTP ${result.httpStatus}`
            + (payload?.msg ? `: ${payload.msg}` : ''),
        );
    }
    return payload?.data ?? payload;
}

/** Verify the browser session is logged into the podcaster backend. */
export async function assertLoggedIn(page) {
    const script = `(async () => {
      try {
        const response = await fetch('${PODCASTER_API}/v1/profile/get', {
          method: 'GET',
          credentials: 'include',
          headers: { 'x-jike-allow-app-token-in-cookie': 'true' },
        });
        const text = await response.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (error) { parsed = null; }
        return {
          httpStatus: response.status,
          errorCode: parsed && parsed.code,
          pageUrl: location.href,
          loginFormVisible: !!document.querySelector('input[type="password"], form[action*="login"]'),
        };
      } catch (error) {
        return { httpStatus: 0, error: String((error && error.message) || error), pageUrl: location.href };
      }
    })()`;
    const result = await evaluate(page, script);
    if (!result || result.httpStatus === 401 || result.httpStatus === 403 || result.errorCode === 401 || result.errorCode === 403) {
        throw new AuthRequiredError(
            PODCASTER_HOST,
            'Xiaoyuzhou podcaster backend requires a signed-in session',
            `Open https://${PODCASTER_HOST}/ in Chrome, sign in (scan the QR code), then retry.`,
        );
    }
    if (result.loginFormVisible || /\/login/.test(String(result.pageUrl || ''))) {
        throw new AuthRequiredError(
            PODCASTER_HOST,
            'Xiaoyuzhou podcaster backend redirected to the login page',
            `Open https://${PODCASTER_HOST}/ in Chrome, sign in (scan the QR code), then retry.`,
        );
    }
    return result;
}

/**
 * The upload dialog is a Mantine modal whose content is mounted from a
 * requestAnimationFrame driven transition. Chrome does not run rAF for hidden
 * pages, so a backgrounded tab would leave the dialog empty forever.
 */
export async function ensurePageVisible(page) {
    const read = async () => evaluate(page, '(() => document.visibilityState)()');
    let visibility = await read();
    if (visibility === 'visible') {
        return true;
    }
    // Best effort: activate the tab we own, which usually is enough.
    try {
        const active = typeof page.getActivePage === 'function' ? page.getActivePage() : null;
        if (active && typeof page.selectTab === 'function') {
            await page.selectTab(active);
        }
    }
    catch {
        // The bridge may not allow switching tabs; fall through to the check.
    }
    await sleep(page, 1);
    visibility = await read();
    return visibility === 'visible';
}

export async function assertPageVisible(page) {
    if (await ensurePageVisible(page)) {
        return;
    }
    throw new CommandExecutionError(
        'The Xiaoyuzhou podcaster page is not visible (Chrome window is minimised or another tab is in front)',
        'The upload dialog of the podcaster backend only renders in a visible page. Bring the Chrome window to the front (or run the command with --window foreground) and retry.',
    );
}

/** Open the "上传播客" modal and wait until the audio file input is mounted. */
export async function openAudioUploadModal(page, timeoutSeconds) {
    const clicked = await evaluate(page, `(() => {
      const candidates = [...document.querySelectorAll(${JSON.stringify(SELECTORS.uploadPlaceholder)})]
        .filter((el) => !el.closest('div[name="image"]'));
      const target = candidates[0];
      if (!target) return { ok: false, reason: 'placeholder not found' };
      target.click();
      return { ok: true };
    })()`);
    if (!clicked?.ok) {
        throw new CommandExecutionError(
            'Could not find the audio upload placeholder on the 创建单集 page',
            'The Xiaoyuzhou podcaster UI may have changed; check the selectors at the top of this adapter.',
        );
    }

    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
        const state = await evaluate(page, `(() => {
          const input = document.querySelector(${JSON.stringify(SELECTORS.audioFileInput)});
          return { hasInput: !!input, accept: input ? input.getAttribute('accept') : '' };
        })()`);
        if (state?.hasInput) {
            return state;
        }
        await sleep(page, DEFAULT_POLL_SECONDS);
    }
    const visibility = await evaluate(page, '(() => document.visibilityState)()');
    if (visibility !== 'visible') {
        throw new CommandExecutionError(
            'The Xiaoyuzhou upload dialog stayed empty because the page is not visible',
            'Bring the Chrome window to the front (or run the command with --window foreground) and retry.',
        );
    }
    throw new TimeoutError(
        'xiaoyuzhou upload',
        timeoutSeconds,
        'The 上传播客 dialog did not expose its audio file input in time. Retry, or raise --timeout.',
    );
}

/**
 * Attach a local file to a file input and let the page upload it.
 */
export async function attachFile(page, { url, fileName, mimeType, selector }) {
    const script = `(async () => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return { ok: false, reason: 'file input not found' };
      try {
        const response = await fetch(${JSON.stringify(url)});
        if (!response.ok) return { ok: false, reason: 'local file fetch failed with HTTP ' + response.status };
        const blob = await response.blob();
        const file = new File([blob], ${JSON.stringify(fileName)}, { type: ${JSON.stringify(mimeType)} });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, name: file.name, size: file.size };
      } catch (error) {
        return { ok: false, reason: String((error && error.message) || error) };
      }
    })()`;
    const result = await evaluate(page, script);
    if (!result?.ok) {
        throw new CommandExecutionError(`Failed to attach ${fileName} to the page: ${result?.reason || 'unknown error'}`);
    }
    return result;
}

/**
 * Wait until the page finished uploading the file.
 *
 * The upload card renders a progress bar (role="progressbar") while the bytes
 * are on their way and the parsed duration (mm:ss) once the file is accepted,
 * so both markers are locale independent. The duration may carry a label
 * ("音频 · 00:30"), so only the trailing "mm:ss" is matched; "00:00" is the idle
 * player placeholder and never counts.
 */
export async function waitForUploadDone(page, fileName, timeoutSeconds) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let lastSeen = '';
    while (Date.now() < deadline) {
        const state = await evaluate(page, `(() => {
          const name = ${JSON.stringify(fileName)};
          const scope = document.querySelector('.mantine-Modal-content') || document.body;
          let hasFile = false;
          let hasDuration = false;
          for (const el of scope.querySelectorAll('*')) {
            if (el.children.length !== 0) continue;
            const text = (el.textContent || '').trim();
            if (text === name) hasFile = true;
            if (/^(?:[^\\d]*)?\\d{1,2}:\\d{2}$/.test(text) && !text.endsWith('00:00')) hasDuration = true;
          }
          const uploading = scope.querySelectorAll('[role="progressbar"]').length > 0;
          const failed = /\\u4e0a\\u4f20\\u5931\\u8d25|upload failed/i.test(scope.innerText || '');
          return { hasFile, hasDuration, uploading, failed };
        })()`);
        if (state?.failed) {
            throw new CommandExecutionError(
                `Xiaoyuzhou reported an upload failure for ${fileName}`,
                'Check the file format (WAV / MP3 / M4A) and size, then retry from the podcaster backend.',
            );
        }
        if (state?.hasFile && !state.uploading && state?.hasDuration) {
            return state;
        }
        lastSeen = state?.hasFile ? 'file selected, still uploading' : lastSeen;
        await sleep(page, DEFAULT_POLL_SECONDS);
    }
    throw new TimeoutError(
        'xiaoyuzhou upload',
        timeoutSeconds,
        `The upload of ${fileName} did not finish in time (${lastSeen || 'no progress'}). Retry, or raise --timeout.`,
    );
}

/** Confirm the cover crop dialog that pops up after a cover file is picked. */
export async function confirmCoverCrop(page, timeoutSeconds) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
        const result = await evaluate(page, `(() => {
          const modals = [...document.querySelectorAll('.mantine-Modal-content')];
          for (const modal of modals) {
            const buttons = [...modal.querySelectorAll('button')];
            const crop = buttons.find((b) => /\\u88c1\\u5207|\\u88c1\\u526a|crop/i.test((b.innerText || '').trim()));
            if (crop) { crop.click(); return { ok: true }; }
            const confirm = buttons.find((b) => /^(confirm|\\u786e\\u8ba4|\\u786e\\u5b9a|\\u5b8c\\u6210|ok|apply)$/i.test((b.innerText || '').trim()));
            if (confirm && /\\u88c1\\u5207|\\u5c01\\u9762|crop/i.test(modal.innerText || '')) { confirm.click(); return { ok: true }; }
          }
          return { ok: false };
        })()`);
        if (result?.ok) {
            return result;
        }
        await sleep(page, DEFAULT_POLL_SECONDS);
    }
    throw new TimeoutError(
        'xiaoyuzhou upload',
        timeoutSeconds,
        'The cover crop dialog did not appear in time.',
    );
}

/** Wait until the cover image was uploaded and rendered in the cover field. */
export async function waitForCoverReady(page, timeoutSeconds) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
        const state = await evaluate(page, `(() => {
          const field = document.querySelector('div[name="image"]');
          if (!field) return { ready: false };
          const img = field.querySelector('img[src]');
          const uploading = field.querySelectorAll('[role="progressbar"]').length > 0;
          return { ready: !!img && !uploading, src: img ? img.getAttribute('src') : '' };
        })()`);
        if (state?.ready) {
            return state;
        }
        await sleep(page, DEFAULT_POLL_SECONDS);
    }
    throw new TimeoutError(
        'xiaoyuzhou upload',
        timeoutSeconds,
        'The cover image was not uploaded in time.',
    );
}

/** Close the upload modal (the collapse button first, Escape as a fallback). */
export async function closeUploadModal(page) {
    const script = `(() => {
      const modal = document.querySelector('.mantine-Modal-content');
      if (!modal) return { ok: true, alreadyClosed: true };
      const button = [...modal.querySelectorAll('button')]
        .find((b) => /\\u6536\\u8d77|collapse|close|\\u5173\\u95ed/i.test((b.innerText || '').trim()));
      if (button) { button.click(); return { ok: true, via: 'button' }; }
      return { ok: false };
    })()`;
    await evaluate(page, script);
    await sleep(page, 1);
    const stillOpen = await evaluate(page, '(() => !!document.querySelector(\'.mantine-Modal-content\'))()');
    if (stillOpen) {
        try {
            await page.pressKey('Escape');
        }
        catch {
            // The modal may simply refuse to close; the form is still usable.
        }
        await sleep(page, 1);
    }
}

/** Fill the title field the way React expects it. */
export async function fillTitle(page, title) {
    const script = `(() => {
      const input = document.querySelector(${JSON.stringify(SELECTORS.titleInput)});
      if (!input) return { ok: false, reason: 'title input not found' };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(title)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, value: input.value };
    })()`;
    const result = await evaluate(page, script);
    if (!result?.ok) {
        throw new CommandExecutionError(`Failed to fill the episode title: ${result?.reason || 'unknown error'}`);
    }
    if (result.value !== title) {
        throw new CommandExecutionError('The episode title field did not keep the requested value');
    }
}

/** Fill the Shownotes editor (ProseMirror) with plain text. */
export async function fillDescription(page, description) {
    const script = `(() => {
      const editor = document.querySelector(${JSON.stringify(SELECTORS.shownotesEditor)});
      if (!editor) return { ok: false, reason: 'shownotes editor not found' };
      editor.focus();
      const text = ${JSON.stringify(description)};
      const inserted = document.execCommand('insertText', false, text);
      return { ok: true, inserted, text: (editor.innerText || '').trim() };
    })()`;
    const result = await evaluate(page, script);
    if (!result?.ok) {
        throw new CommandExecutionError(`Failed to fill the episode description: ${result?.reason || 'unknown error'}`);
    }
    if (!result.text) {
        throw new CommandExecutionError('The Shownotes editor did not accept the description text');
    }
}

/** Toggle the "本音频为 AI 生成" switch. */
export async function setAiGenerated(page, enabled) {
    const script = `(() => {
      const input = document.querySelector(${JSON.stringify(SELECTORS.aiGeneratedSwitch)});
      if (!input) return { ok: false, reason: 'AI switch not found' };
      if (input.checked !== ${enabled ? 'true' : 'false'}) input.click();
      return { ok: true, checked: input.checked };
    })()`;
    const result = await evaluate(page, script);
    if (!result?.ok) {
        throw new CommandExecutionError(`Failed to set the AI-generated switch: ${result?.reason || 'unknown error'}`);
    }
    return result.checked;
}

/** Tick the creator service agreement checkbox. */
export async function acceptAgreement(page) {
    const script = `(() => {
      const link = document.querySelector(${JSON.stringify(SELECTORS.agreementLink)});
      if (!link) return { ok: false, reason: 'agreement link not found' };
      let node = link;
      let input = null;
      for (let i = 0; i < 6 && node; i += 1) {
        input = node.querySelector('input[type="checkbox"]');
        if (input) break;
        node = node.parentElement;
      }
      if (!input) return { ok: false, reason: 'agreement checkbox not found' };
      if (!input.checked) input.click();
      return { ok: true, checked: input.checked };
    })()`;
    const result = await evaluate(page, script);
    if (!result?.ok) {
        throw new CommandExecutionError(`Failed to tick the service agreement: ${result?.reason || 'unknown error'}`);
    }
    if (!result.checked) {
        throw new CommandExecutionError('The service agreement checkbox could not be ticked');
    }
}

/** Submit the episode form and return the new episode id. */
export async function submitEpisodeForm(page, timeoutSeconds) {
    const script = `(() => {
      const buttons = [...document.querySelectorAll(${JSON.stringify(SELECTORS.submitButton)})];
      const preferred = buttons.find((b) => /\\u521b\\u5efa|\\u63d0\\u4ea4|create|submit/i.test((b.innerText || '').trim()));
      const button = preferred || buttons[buttons.length - 1];
      if (!button) return { ok: false, reason: 'submit button not found' };
      button.click();
      return { ok: true };
    })()`;
    const result = await evaluate(page, script);
    if (!result?.ok) {
        throw new CommandExecutionError(`Failed to submit the episode form: ${result?.reason || 'unknown error'}`);
    }
    const deadline = Date.now() + timeoutSeconds * 1000;
    while (Date.now() < deadline) {
        const url = await evaluate(page, '(() => location.href)()');
        const match = /\/episode\/([0-9a-f]{24})/i.exec(String(url || ''));
        if (match) {
            return match[1];
        }
        await sleep(page, DEFAULT_POLL_SECONDS);
    }
    const notice = await evaluate(page, `(() => {
      const text = document.body.innerText || '';
      const marker = text.indexOf('\\u97f3\\u9891\\u6587\\u4ef6\\u672a\\u4e0a\\u4f20\\u6210\\u529f');
      if (marker >= 0) return text.slice(marker, marker + 120);
      return text.slice(-200);
    })()`);
    throw new TimeoutError(
        'xiaoyuzhou upload',
        timeoutSeconds,
        `The episode form was submitted but the backend never returned an episode id. Last page state: ${String(notice || '').replace(/\s+/g, ' ').slice(0, 160)}`,
    );
}

/** Map the raw episode status onto the draft / reviewing / published states. */
export function normalizeEpisodeStatus(episode) {
    const status = String(episode?.status || '').toUpperCase();
    const review = String(episode?.reviewStatus || '').toUpperCase();
    const neverPublished = episode?.hasNeverPublished === true || episode?.hasNeverPublished === 'true';
    if (status === 'REMOVED' || status === 'DELETED') {
        return 'removed';
    }
    if (status === 'NORMAL' && !neverPublished) {
        if (review === 'PENDING') {
            return 'reviewing';
        }
        if (review === 'REJECTED') {
            return 'rejected';
        }
        return 'published';
    }
    if (review === 'REJECTED') {
        return 'rejected';
    }
    return 'draft';
}

cli({
    site: SITE,
    name: 'upload',
    access: 'write',
    description: 'Upload an audio file as a new episode (单集) on the Xiaoyuzhou podcaster backend',
    domain: PODCASTER_HOST,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'audio', positional: true, required: true, help: 'Local audio file to upload (wav / mp3 / m4a)' },
        { name: 'title', required: true, help: 'Episode title (单集标题)' },
        { name: 'description', help: 'Episode description / shownotes (简介)' },
        { name: 'cover', help: 'Local cover image (jpg / png / webp)' },
        { name: 'podcast', default: DEFAULT_PODCAST_ID, help: 'Podcast id (required; or set YT2PODCAST_PODCAST_ID)' },
        { name: 'draft', type: 'boolean', default: true, help: 'Keep the episode as an unpublished draft (default: true)' },
        { name: 'publish', type: 'boolean', help: 'Publish the episode right after creating it (overrides --draft)' },
        { name: 'ai-generated', type: 'boolean', default: true, help: 'Declare the audio as AI generated (default: true)' },
        { name: 'timeout', type: 'int', default: DEFAULT_TIMEOUT_SECONDS, help: `Seconds to wait for the upload (default ${DEFAULT_TIMEOUT_SECONDS})` },
    ],
    columns: ['episode_id', 'episode_url', 'title', 'status', 'draft'],
    func: async (page, args) => {
        if (!args.audio) {
            throw new ArgumentError('<audio-file> is required');
        }
        const audioPath = path.resolve(String(args.audio));
        let audioStat;
        try {
            audioStat = fs.statSync(audioPath);
        }
        catch {
            throw new ArgumentError(`Audio file does not exist: ${args.audio}`);
        }
        if (!audioStat.isFile()) {
            throw new ArgumentError(`Audio path is not a regular file: ${args.audio}`);
        }
        const title = String(args.title ?? '').trim();
        if (!title) {
            throw new ArgumentError('--title must not be empty');
        }
        const description = String(args.description ?? '');
        const podcastId = String(args.podcast || DEFAULT_PODCAST_ID).trim();
        if (!podcastId) {
            throw new ArgumentError('Missing podcast id: pass --podcast <id> or set YT2PODCAST_PODCAST_ID');
        }
        const timeoutSeconds = requirePositiveInt(args.timeout, 'timeout', DEFAULT_TIMEOUT_SECONDS);
        const draft = args.publish === true ? false : args.draft !== false;
        const aiGenerated = args['ai-generated'] !== false;

        let coverPath = null;
        if (args.cover) {
            coverPath = path.resolve(String(args.cover));
            let coverStat;
            try {
                coverStat = fs.statSync(coverPath);
            }
            catch {
                throw new ArgumentError(`Cover image does not exist: ${args.cover}`);
            }
            if (!coverStat.isFile()) {
                throw new ArgumentError(`Cover path is not a regular file: ${args.cover}`);
            }
        }

        const audioName = path.basename(audioPath);
        const audioMime = inferMimeType(audioPath, AUDIO_MIME_BY_EXT, 'application/octet-stream');
        const files = [{ path: audioPath, mimeType: audioMime }];
        if (coverPath) {
            files.push({ path: coverPath, mimeType: inferMimeType(coverPath, IMAGE_MIME_BY_EXT, 'application/octet-stream') });
        }

        await page.goto(buildCreateUrl(podcastId));
        await page.wait(3);
        await assertLoggedIn(page);
        await assertPageVisible(page);

        const serverHandle = await startFileServer(files);
        try {
            // 1. audio
            await openAudioUploadModal(page, timeoutSeconds);
            await attachFile(page, {
                url: `http://127.0.0.1:${serverHandle.port}/file/0`,
                fileName: audioName,
                mimeType: audioMime,
                selector: SELECTORS.audioFileInput,
            });
            await waitForUploadDone(page, audioName, timeoutSeconds);
            await closeUploadModal(page);

            // 2. cover
            if (coverPath) {
                const coverName = path.basename(coverPath);
                await attachFile(page, {
                    url: `http://127.0.0.1:${serverHandle.port}/file/1`,
                    fileName: coverName,
                    mimeType: files[1].mimeType,
                    selector: SELECTORS.coverFileInput,
                });
                await confirmCoverCrop(page, Math.min(timeoutSeconds, 60));
                await waitForCoverReady(page, timeoutSeconds);
            }

            // 3. form
            await fillTitle(page, title);
            if (description) {
                await fillDescription(page, description);
            }
            if (aiGenerated) {
                await setAiGenerated(page, true);
            }
            await acceptAgreement(page);

            // 4. submit
            const episodeId = await submitEpisodeForm(page, timeoutSeconds);

            // 5. publish (only when explicitly requested)
            if (!draft) {
                await apiFetch(page, '/v1/episode/hosted/publish', {
                    method: 'POST',
                    body: { eid: episodeId },
                    podcastId,
                });
            }
            const episode = await apiFetch(page, `/v1/episode/get?eid=${episodeId}`, { podcastId });

            return [{
                episode_id: episodeId,
                episode_url: buildEpisodeUrl(episodeId),
                title: String(episode?.title || title),
                status: normalizeEpisodeStatus(episode),
                draft,
            }];
        }
        finally {
            await stopFileServer(serverHandle);
        }
    },
});
