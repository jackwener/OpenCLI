/**
 * notebooklm download-audio — download the Audio Overview (podcast) of a NotebookLM notebook.
 *
 * Discovery reuses the same in-page batchexecute RPC that the NotebookLM web app
 * uses (LabsTailwindOrchestrationService.ListArtifacts, rpcid `gArtLc`). The
 * artifact record carries the signed `lh3.googleusercontent.com` media URL of the
 * finished audio, which is then fetched with the browser session cookies.
 *
 * Usage:
 *   opencli notebooklm download-audio <notebook> [--output ./nb-audio.wav] [--generate]
 *   opencli notebooklm download-audio <notebook> --timeout 900 --poll 30
 *
 * Notes:
 *   - `--output` (short form `-o` is not supported by the opencli registry, which
 *     only exposes long options) defaults to `./<notebook_id>-audio.wav`.
 *   - A `.wav` target is transcoded to a real PCM WAV with ffmpeg; any other
 *     extension stores the raw NotebookLM audio (audio/mp4) bytes.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const NOTEBOOKLM_SITE = 'notebooklm';
const NOTEBOOKLM_DOMAIN = 'notebook.google.com';
const NOTEBOOKLM_RPC_PATH = '/_/LabsTailwindUi/data/batchexecute';

const LIST_ARTIFACTS_RPC_ID = 'gArtLc';
const CREATE_ARTIFACT_RPC_ID = 'R7cb6c';
const NOTEBOOK_DETAIL_RPC_ID = 'rLM1Ne';

/** LabsTailwindOrchestrationService.ListArtifacts request context block. */
const ARTIFACT_CONTEXT_BLOCK = [
    2,
    null,
    null,
    [1, null, null, null, null, null, null, null, null, null, [1]],
    [[1, 4, 2, 3, 6]],
];
const LIST_ARTIFACTS_FILTER = 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"';

/** CreateArtifact request context block (same shape the built-in generate-audio uses). */
const AUDIO_OVERVIEW_CONFIG_BLOCK = [
    2,
    null,
    null,
    [1, null, null, null, null, null, null, null, null, null, [1]],
    [[1, 4, 2, 3, 6]],
];

const ARTIFACT_TYPE_AUDIO_OVERVIEW = 1;
const ARTIFACT_STATUS_READY = 3;
const ARTIFACT_STATUS_LABELS = {
    1: 'queued',
    2: 'generating',
    3: 'ready',
};

const NOTEBOOK_UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_POLL_SECONDS = 30;
const MAX_REDIRECTS = 8;
const DOWNLOAD_TIMEOUT_MS = 900_000;

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export function parseNotebookTarget(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ArgumentError('<notebook> is required');
    }
    if (NOTEBOOK_UUID_RE.test(raw)) {
        return raw.toLowerCase();
    }
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new ArgumentError(`Notebook must be a notebook id or a notebook.google.com URL (got "${raw}")`);
    }
    if (url.protocol !== 'https:' || url.hostname !== NOTEBOOKLM_DOMAIN) {
        throw new ArgumentError(`Notebook URL must be an https://${NOTEBOOKLM_DOMAIN} URL (got "${raw}")`);
    }
    const match = url.pathname.match(/^\/notebook\/([^/?#]+)/);
    const id = match ? match[1] : '';
    if (!NOTEBOOK_UUID_RE.test(id)) {
        throw new ArgumentError(`Could not parse a notebook id from "${raw}"`);
    }
    return id.toLowerCase();
}

export function buildNotebookUrl(notebookId) {
    return `https://${NOTEBOOKLM_DOMAIN}/notebook/${notebookId}`;
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

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

function requirePlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommandExecutionError(`NotebookLM ${label} returned a malformed Browser Bridge payload`);
    }
    return value;
}

async function probePageAuth(page) {
    const evaluated = await page.evaluate(`(() => {
    const wiz = window.WIZ_global_data || {};
    const html = document.documentElement.innerHTML || '';
    const authMatch = (location.search || '').match(/[?&]authuser=(\\d+)/);
    const pathMatch = (location.pathname || '').match(/^\\/u\\/(\\d+)\\//);
    return {
      csrfToken: typeof wiz.SNlM0e === 'string' ? wiz.SNlM0e : '',
      sessionId: typeof wiz.FdrFJe === 'string' ? wiz.FdrFJe : '',
      authuser: authMatch ? authMatch[1] : (pathMatch ? pathMatch[1] : ''),
      sourcePath: location.pathname || '/',
      url: location.href,
      hasLoginForm: !!document.querySelector('input[type="password"], form[action*="signin"]'),
    };
  })()`);
    const raw = requirePlainObject(unwrapEvaluateResult(evaluated), 'page auth probe');
    if (typeof raw.csrfToken !== 'string' || typeof raw.sessionId !== 'string') {
        throw new CommandExecutionError('NotebookLM page auth probe returned malformed fields');
    }
    return {
        csrfToken: raw.csrfToken,
        sessionId: raw.sessionId,
        authuser: typeof raw.authuser === 'string' ? raw.authuser : '',
        sourcePath: typeof raw.sourcePath === 'string' ? raw.sourcePath : '/',
        url: typeof raw.url === 'string' ? raw.url : '',
        hasLoginForm: raw.hasLoginForm === true,
    };
}

/**
 * Extract the CSRF token from the notebook page HTML when WIZ_global_data is absent.
 */
function extractCsrfFromHtml(html) {
    const match = html.match(/"SNlM0e":"([^"]+)"/);
    return match ? match[1] : '';
}

async function getPageAuth(page) {
    let auth = await probePageAuth(page);
    if (!auth.csrfToken) {
        const evaluated = await page.evaluate('document.documentElement.innerHTML || ""');
        const html = typeof unwrapEvaluateResult(evaluated) === 'string' ? unwrapEvaluateResult(evaluated) : '';
        const csrfToken = extractCsrfFromHtml(html);
        if (!csrfToken) {
            throw new AuthRequiredError(
                NOTEBOOKLM_DOMAIN,
                'NotebookLM session tokens are missing; the browser session is not logged in',
                `Open https://${NOTEBOOKLM_DOMAIN}/ in Chrome, sign in, then retry.`,
            );
        }
        auth = { ...auth, csrfToken };
    }
    return auth;
}

export function buildRpcBody(rpcId, params, csrfToken) {
    const rpcRequest = [[[rpcId, JSON.stringify(params), null, 'generic']]];
    return `f.req=${encodeURIComponent(JSON.stringify(rpcRequest))}&at=${encodeURIComponent(csrfToken)}&`;
}

export function stripAntiXssi(rawBody) {
    if (!rawBody.startsWith(")]}'")) {
        return rawBody;
    }
    return rawBody.replace(/^\)\]\}'\r?\n/, '');
}

export function parseChunkedResponse(rawBody) {
    const cleaned = stripAntiXssi(rawBody).trim();
    if (!cleaned) {
        return [];
    }
    const lines = cleaned.split('\n');
    const chunks = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        if (!line) {
            continue;
        }
        if (/^\d+$/.test(line)) {
            const next = lines[i + 1];
            if (next) {
                try {
                    chunks.push(JSON.parse(next));
                }
                catch {
                    // Ignore malformed chunks and keep scanning.
                }
            }
            i += 1;
            continue;
        }
        if (line.startsWith('[')) {
            try {
                chunks.push(JSON.parse(line));
            }
            catch {
                // Ignore malformed chunks and keep scanning.
            }
        }
    }
    return chunks;
}

export function extractRpcResult(rawBody, rpcId) {
    const chunks = parseChunkedResponse(rawBody);
    for (const chunk of chunks) {
        if (!Array.isArray(chunk)) {
            continue;
        }
        const items = Array.isArray(chunk[0]) ? chunk : [chunk];
        for (const item of items) {
            if (!Array.isArray(item) || item.length < 1) {
                continue;
            }
            if (item[0] === 'er') {
                const code = typeof item[2] === 'number' ? item[2] : (typeof item[5] === 'number' ? item[5] : null);
                if (code === 401 || code === 403) {
                    throw new AuthRequiredError(NOTEBOOKLM_DOMAIN, `NotebookLM RPC returned auth error (${code})`);
                }
                const detail = typeof item[5] === 'string' ? item[5] : (typeof item[3] === 'string' ? item[3] : '');
                throw new CliError(
                    'NOTEBOOKLM_RPC',
                    `NotebookLM RPC ${rpcId} failed${code !== null ? ` (code=${code})` : ''}${detail ? `: ${detail}` : ''}`,
                    'The request may have been rejected (for example the daily audio-generation quota is exhausted). Retry later or generate the Audio Overview from the NotebookLM UI.',
                );
            }
            if (item[0] === 'wrb.fr' && item[1] === rpcId) {
                const payload = item[2];
                if (typeof payload === 'string') {
                    try {
                        return JSON.parse(payload);
                    }
                    catch {
                        throw new CliError('NOTEBOOKLM_RPC_SCHEMA', `NotebookLM RPC ${rpcId} returned malformed JSON`, 'Retry from the NotebookLM page; the internal RPC response shape may have changed.');
                    }
                }
                return payload;
            }
        }
    }
    throw new CliError('NOTEBOOKLM_RPC_SCHEMA', `NotebookLM RPC ${rpcId} returned no matching response frame`, 'Retry from the NotebookLM page; the internal RPC response shape may have changed.');
}

async function fetchInPage(page, url, options = {}) {
    const method = options.method ?? 'GET';
    const headers = options.headers ?? {};
    const body = options.body ?? '';
    const evaluated = await page.evaluate(`(async () => {
    const request = {
      url: ${JSON.stringify(url)},
      method: ${JSON.stringify(method)},
      headers: ${JSON.stringify(headers)},
      body: ${JSON.stringify(body)},
    };
    const requestUrl = new URL(request.url, location.href).href;
    const response = await fetch(requestUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method === 'GET' ? undefined : request.body,
      credentials: 'include',
    });
    return {
      ok: response.ok,
      httpStatus: response.status,
      responseBody: await response.text(),
      requestedUrl: requestUrl,
      resolvedUrl: response.url,
    };
  })()`);
    const raw = requirePlainObject(unwrapEvaluateResult(evaluated), 'RPC transport');
    return {
        ok: raw.ok === true,
        httpStatus: Number(raw.httpStatus) || 0,
        responseBody: typeof raw.responseBody === 'string' ? raw.responseBody : '',
        requestUrl: String(raw.requestedUrl || ''),
        finalUrl: String(raw.resolvedUrl || ''),
    };
}

export async function callRpc(page, rpcId, params) {
    const auth = await getPageAuth(page);
    const requestBody = buildRpcBody(rpcId, params, auth.csrfToken);
    const authuser = auth.authuser || '';
    const url = NOTEBOOKLM_RPC_PATH
        + `?rpcids=${rpcId}&source-path=${encodeURIComponent(auth.sourcePath)}`
        + (authuser ? `&authuser=${encodeURIComponent(authauthuserSafe(authuser))}` : '')
        + '&hl=en'
        + `&f.sid=${encodeURIComponent(auth.sessionId)}&rt=c`;
    const response = await fetchInPage(page, url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: requestBody,
    });
    if (response.httpStatus === 401 || response.httpStatus === 403) {
        throw new AuthRequiredError(NOTEBOOKLM_DOMAIN, `NotebookLM RPC returned auth error (${response.httpStatus})`);
    }
    if (!response.ok) {
        throw new CliError('NOTEBOOKLM_RPC', `NotebookLM RPC request failed with HTTP ${response.httpStatus}`, 'Retry from an already logged-in NotebookLM session.');
    }
    return extractRpcResult(response.responseBody, rpcId);
}

function authauthuserSafe(value) {
    return /^\d+$/.test(String(value)) ? String(value) : '';
}

/** Unwrap the singleton wrapper NotebookLM uses for notebook-detail payloads. */
function unwrapSingleton(result) {
    let current = result;
    while (Array.isArray(current) && current.length === 1 && Array.isArray(current[0])) {
        current = current[0];
    }
    return current;
}

export function parseSourceIds(result) {
    const detail = unwrapSingleton(result);
    if (!Array.isArray(detail)) {
        return [];
    }
    const rawSources = Array.isArray(detail[1]) ? detail[1] : [];
    const ids = [];
    for (const entry of rawSources) {
        if (!Array.isArray(entry)) {
            continue;
        }
        const holder = entry[0];
        const stack = [holder];
        while (stack.length) {
            const node = stack.shift();
            if (typeof node === 'string') {
                if (NOTEBOOK_UUID_RE.test(node)) {
                    ids.push(node);
                    break;
                }
                continue;
            }
            if (Array.isArray(node)) {
                stack.push(...node);
                continue;
            }
            if (node && typeof node === 'object') {
                stack.push(...Object.values(node));
            }
        }
    }
    return [...new Set(ids)];
}

export function parseArtifactRows(result) {
    let payload = result;
    if (typeof payload === 'string') {
        payload = JSON.parse(payload);
    }
    if (!Array.isArray(payload)) {
        return [];
    }
    const rows = payload.length === 1 && Array.isArray(payload[0]) && Array.isArray(payload[0][0])
        ? payload[0]
        : (payload.length === 1 && Array.isArray(payload[0]) ? payload[0] : payload);
    return rows.filter((row) => Array.isArray(row) && typeof row[0] === 'string' && NOTEBOOK_UUID_RE.test(row[0]));
}

export function parseAudioArtifact(row) {
    if (!Array.isArray(row)) {
        return null;
    }
    const options = Array.isArray(row[6]) ? row[6] : [];
    const generation = Array.isArray(options[1]) ? options[1] : [];
    const variants = Array.isArray(options[5]) ? options[5] : [];
    const duration = Array.isArray(options[6]) ? options[6] : null;
    const durationSeconds = Array.isArray(duration) && typeof duration[0] === 'number'
        ? duration[0] + (typeof duration[1] === 'number' ? duration[1] / 1e9 : 0)
        : null;
    const media = variants
        .filter((variant) => Array.isArray(variant) && typeof variant[0] === 'string' && /^https:\/\//.test(variant[0]))
        .map((variant) => ({
            url: variant[0],
            kind: typeof variant[1] === 'number' ? variant[1] : null,
            mime: typeof variant[2] === 'string' ? variant[2] : null,
        }));
    return {
        artifactId: row[0],
        artifactTitle: typeof row[1] === 'string' ? row[1] : '',
        artifactType: typeof row[2] === 'number' ? row[2] : null,
        artifactStatus: typeof row[4] === 'number' ? row[4] : null,
        artifactStatusLabel: typeof row[4] === 'number' ? (ARTIFACT_STATUS_LABELS[row[4]] ?? null) : null,
        artifactLanguage: typeof generation[4] === 'string' ? generation[4] : null,
        artifactDurationSeconds: durationSeconds,
        artifactMedia: media,
        artifactAudioUrl: typeof options[2] === 'string' && /^https:\/\//.test(options[2]) ? options[2] : null,
    };
}

/** Prefer the progressive audio file over the HLS/DASH streaming manifests. */
export function pickAudioUrl(artifact) {
    const progressive = artifact.artifactMedia.find((item) => item.kind === 1 && item.mime);
    if (progressive) {
        return progressive.url;
    }
    const anyAudio = artifact.artifactMedia.find((item) => item.mime && item.mime.startsWith('audio/'));
    if (anyAudio) {
        return anyAudio.url;
    }
    const notStream = artifact.artifactMedia.find((item) => item.kind === 1 || item.kind === 4);
    if (notStream) {
        return notStream.url;
    }
    return artifact.artifactAudioUrl || artifact.artifactMedia[0]?.url || '';
}

function cookieMatchesHost(cookieDomain, hostname) {
    const domain = String(cookieDomain || '').replace(/^\./, '').toLowerCase();
    const host = String(hostname || '').toLowerCase();
    if (!domain) {
        return false;
    }
    return host === domain || host.endsWith(`.${domain}`);
}

export function buildCookieHeader(cookies, hostname) {
    return cookies
        .filter((cookie) => cookieMatchesHost(cookie.domain, hostname))
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join('; ');
}

/**
 * Download a signed NotebookLM media URL. Redirects are followed manually so the
 * Google cookies survive the lh3.googleusercontent.com -> lh3.google.com hop.
 */
export async function downloadSignedMedia(page, url, destPath) {
    // Cookie scopes are requested explicitly: the browser bridge refuses to dump
    // every cookie, and the media URL hops between googleusercontent.com and google.com.
    const scoped = [];
    for (const domain of ['googleusercontent.com', 'google.com']) {
        try {
            scoped.push(...await page.getCookies({ domain }));
        }
        catch {
            // Ignore a missing scope; the signed media URL may not need it.
        }
    }
    const seen = new Set();
    const cookies = scoped.filter((cookie) => {
        const key = `${cookie.name}=${cookie.value}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
    let currentUrl = String(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const host = new URL(currentUrl).hostname;
        const headers = { 'User-Agent': USER_AGENT };
        const cookieHeader = buildCookieHeader(cookies, host);
        if (cookieHeader) {
            headers.Cookie = cookieHeader;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(currentUrl, { headers, redirect: 'manual', signal: controller.signal });
        }
        catch (error) {
            clearTimeout(timer);
            throw new CommandExecutionError(`Downloading the NotebookLM audio failed: ${error?.message || error}`);
        }
        clearTimeout(timer);
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) {
                throw new CommandExecutionError(`NotebookLM audio download returned HTTP ${response.status} without a redirect target`);
            }
            currentUrl = new URL(location, currentUrl).toString();
            continue;
        }
        if (response.status !== 200) {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
                throw new AuthRequiredError(
                    NOTEBOOKLM_DOMAIN,
                    'NotebookLM audio download returned a sign-in page instead of media',
                    `Re-authenticate in Chrome at https://${NOTEBOOKLM_DOMAIN}/ and retry.`,
                );
            }
            throw new CommandExecutionError(`NotebookLM audio download failed with HTTP ${response.status}`);
        }
        const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const resolved = path.resolve(destPath);
        await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
        if (!response.body) {
            throw new CommandExecutionError('NotebookLM audio download returned an empty body');
        }
        // Stream to disk: audio overviews can be tens of megabytes and the media
        // CDN is often reached through a slow proxy.
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(resolved));
        const stat = await fs.promises.stat(resolved);
        return { bytes: stat.size, content_type: contentType || null };
    }
    throw new CommandExecutionError(`NotebookLM audio download exceeded ${MAX_REDIRECTS} redirects`);
}

function runFfmpeg(args) {
    return new Promise((resolve) => {
        execFile('ffmpeg', args, { timeout: 15 * 60_000 }, (error, stdout, stderr) => {
            resolve({ ok: !error, stdout, stderr: String(stderr || '') });
        });
    });
}

/**
 * NotebookLM serves Audio Overview media as audio/mp4. When the requested output
 * file is a .wav, transcode it so the file on disk really is a playable WAV.
 */
export async function ensureWavContainer(sourcePath, destPath) {
    const result = await runFfmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', sourcePath, '-c:a', 'pcm_s16le', destPath]);
    if (!result.ok) {
        return { converted: false, error: result.stderr.trim().split('\n').slice(-1)[0] || 'ffmpeg failed' };
    }
    const stat = await fs.promises.stat(destPath);
    return { converted: true, byteSize: stat.size };
}

async function sleepSeconds(page, seconds) {
    if (typeof page.wait === 'function') {
        await page.wait(seconds);
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function listArtifacts(page, notebookId) {
    const result = await callRpc(page, LIST_ARTIFACTS_RPC_ID, [
        ARTIFACT_CONTEXT_BLOCK,
        notebookId,
        LIST_ARTIFACTS_FILTER,
    ]);
    return parseArtifactRows(result).map(parseAudioArtifact);
}

async function listSourceIds(page, notebookId) {
    const result = await callRpc(page, NOTEBOOK_DETAIL_RPC_ID, [notebookId, null, [2], null, 0]);
    return parseSourceIds(result);
}

async function triggerGeneration(page, notebookId) {
    const sourceIds = await listSourceIds(page, notebookId);
    if (sourceIds.length === 0) {
        throw new EmptyResultError('notebooklm download-audio', 'The notebook has no sources; add a source before generating an audio overview.');
    }
    const sourceTuples = sourceIds.map((id) => [[id]]);
    const sourceTuplesTail = sourceIds.map((id) => [id]);
    const args = [
        AUDIO_OVERVIEW_CONFIG_BLOCK,
        notebookId,
        [
            null,
            null,
            1,
            sourceTuples,
            null,
            null,
            [null, [null, null, null, sourceTuplesTail]],
        ],
    ];
    const result = await callRpc(page, CREATE_ARTIFACT_RPC_ID, args);
    const rows = parseArtifactRows(result);
    const created = rows.map(parseAudioArtifact).find((row) => row && row.artifactType === ARTIFACT_TYPE_AUDIO_OVERVIEW);
    return {
        triggeredArtifactId: created?.artifact_id ?? null,
        triggeredSourceCount: sourceIds.length,
    };
}

cli({
    site: NOTEBOOKLM_SITE,
    name: 'download-audio',
    access: 'write',
    description: 'Download the Audio Overview (podcast) of a NotebookLM notebook to a local audio file',
    domain: NOTEBOOKLM_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'notebook', positional: true, required: true, help: 'Notebook id from `notebooklm list` or full notebook URL' },
        { name: 'output', help: 'Output file path (default ./<notebook_id>-audio.wav). A .wav target is transcoded to real PCM WAV.' },
        { name: 'timeout', type: 'int', default: DEFAULT_TIMEOUT_SECONDS, help: `Seconds to wait for the audio overview to become ready (default ${DEFAULT_TIMEOUT_SECONDS})` },
        { name: 'poll', type: 'int', default: DEFAULT_POLL_SECONDS, help: `Seconds between readiness checks (default ${DEFAULT_POLL_SECONDS})` },
        { name: 'generate', type: 'boolean', help: 'Trigger an Audio Overview generation when the notebook has none yet' },
    ],
    columns: ['notebook_id', 'file', 'bytes', 'status', 'artifact_id', 'title', 'duration_seconds', 'language', 'content_type', 'converted_to_wav'],
    func: async (page, kwargs) => {
        const notebookId = parseNotebookTarget(kwargs.notebook);
        const timeoutSeconds = requirePositiveInt(kwargs.timeout, 'timeout', DEFAULT_TIMEOUT_SECONDS);
        const pollSeconds = requirePositiveInt(kwargs.poll, 'poll', DEFAULT_POLL_SECONDS);
        const outputPath = path.resolve(
            String(kwargs.output && String(kwargs.output).trim() ? String(kwargs.output).trim() : path.join(process.cwd(), `${notebookId}-audio.wav`)),
        );

        await page.goto(buildNotebookUrl(notebookId));
        await page.wait(2);
        const auth = await getPageAuth(page);
        if (auth.hasLoginForm && !auth.csrfToken) {
            throw new AuthRequiredError(NOTEBOOKLM_DOMAIN, 'NotebookLM requires a logged-in Google session');
        }

        let artifacts = await listArtifacts(page, notebookId);
        let audio = artifacts.find((row) => row.artifactType === ARTIFACT_TYPE_AUDIO_OVERVIEW) || null;

        if (!audio) {
            if (!kwargs.generate) {
                throw new EmptyResultError(
                    'notebooklm download-audio',
                    `Notebook ${notebookId} has no Audio Overview yet. Re-run with --generate to create one.`,
                );
            }
            const triggered = await triggerGeneration(page, notebookId);
            const deadline = Date.now() + timeoutSeconds * 1000;
            let lastStatus = null;
            while (Date.now() < deadline) {
                artifacts = await listArtifacts(page, notebookId);
                audio = artifacts.find((row) => row.artifactType === ARTIFACT_TYPE_AUDIO_OVERVIEW) || null;
                if (audio) {
                    lastStatus = audio.artifactStatusLabel;
                    if (audio.artifactStatus === ARTIFACT_STATUS_READY) {
                        break;
                    }
                }
                await sleepSeconds(page, Math.min(pollSeconds, Math.max(1, Math.round((deadline - Date.now()) / 1000))));
            }
            if (!audio || audio.artifactStatus !== ARTIFACT_STATUS_READY) {
                throw new CliError(
                    'NOTEBOOKLM_AUDIO_TIMEOUT',
                    `Audio Overview for notebook ${notebookId} was not ready after ${timeoutSeconds}s (last status: ${lastStatus ?? 'not observed'})`,
                    'Increase --timeout, or check the NotebookLM UI for a quota or generation error.',
                );
            }
            if (triggered.triggeredArtifactId && audio.artifactId && triggered.triggeredArtifactId !== audio.artifactId) {
                audio = artifacts.find((row) => row.artifactId === triggered.triggeredArtifactId) || audio;
            }
        }

        const deadline = Date.now() + timeoutSeconds * 1000;
        while (audio.artifactStatus !== ARTIFACT_STATUS_READY && Date.now() < deadline) {
            await sleepSeconds(page, Math.min(pollSeconds, Math.max(1, Math.round((deadline - Date.now()) / 1000))));
            artifacts = await listArtifacts(page, notebookId);
            const refreshed = artifacts.find((row) => row.artifactId === audio.artifactId);
            if (refreshed) {
                audio = refreshed;
            }
            else {
                audio = artifacts.find((row) => row.artifactType === ARTIFACT_TYPE_AUDIO_OVERVIEW) || audio;
            }
        }
        if (audio.artifactStatus !== ARTIFACT_STATUS_READY) {
            throw new CliError(
                'NOTEBOOKLM_AUDIO_TIMEOUT',
                `Audio Overview for notebook ${notebookId} was not ready after ${timeoutSeconds}s (last status: ${audio.artifactStatusLabel ?? 'not observed'})`,
                'Increase --timeout, or check the NotebookLM UI for a quota or generation error.',
            );
        }

        const audioUrl = pickAudioUrl(audio);
        if (!audioUrl) {
            throw new CommandExecutionError('The NotebookLM Audio Overview artifact carries no downloadable media URL');
        }

        const wantsWav = path.extname(outputPath).toLowerCase() === '.wav';
        const rawPath = wantsWav ? `${outputPath}.download` : outputPath;
        const downloaded = await downloadSignedMedia(page, audioUrl, rawPath);

        let bytes = downloaded.bytes;
        let contentType = downloaded.content_type;
        let converted = false;
        if (wantsWav) {
            const convertedResult = await ensureWavContainer(rawPath, outputPath);
            await fs.promises.rm(rawPath, { force: true });
            if (convertedResult.converted) {
                converted = true;
                bytes = convertedResult.byteSize;
                contentType = 'audio/wav';
            }
            else {
                await fs.promises.rename(rawPath, outputPath).catch(async () => {
                    await fs.promises.copyFile(rawPath, outputPath);
                    await fs.promises.rm(rawPath, { force: true });
                });
            }
        }

        return [{
            notebook_id: notebookId,
            file: outputPath,
            bytes,
            status: 'done',
            artifact_id: audio.artifactId,
            title: audio.artifactTitle,
            duration_seconds: audio.artifactDurationSeconds,
            language: audio.artifactLanguage,
            content_type: contentType,
            converted_to_wav: converted,
        }];
    },
});

export const __test__ = {
    parseNotebookTarget,
    buildNotebookUrl,
    requirePositiveInt,
    buildRpcBody,
    parseChunkedResponse,
    extractRpcResult,
    parseSourceIds,
    parseArtifactRows,
    parseAudioArtifact,
    pickAudioUrl,
    buildCookieHeader,
};
