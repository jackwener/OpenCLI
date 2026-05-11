import { ArgumentError } from '@jackwener/opencli/errors';

export const DEEPSEEK_DOMAIN = 'chat.deepseek.com';
export const DEEPSEEK_URL = 'https://chat.deepseek.com/';
export const TEXTAREA_SELECTOR = 'textarea[placeholder*="DeepSeek"]';
export const MESSAGE_SELECTOR = '.ds-message';
const CONVERSATION_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/**
 * Normalize a DeepSeek conversation ID. Accepts a bare UUID or any URL that
 * embeds one (`/a/chat/s/<id>` or full chat URL).
 *
 * Throws ArgumentError when the input does not contain a UUID-shaped id, so
 * `detail` fails before any browser navigation happens.
 */
export function parseDeepSeekConversationId(input) {
    const raw = String(input ?? '').trim();
    if (!raw) {
        throw new ArgumentError('id', 'must be a non-empty conversation ID or URL');
    }
    const urlMatch = raw.match(/\/a\/chat\/s\/([a-f0-9-]+)/i);
    const candidate = urlMatch ? urlMatch[1] : raw;
    if (!CONVERSATION_ID_RE.test(candidate)) {
        throw new ArgumentError(
            'id',
            `not a valid DeepSeek conversation ID (got "${input}"); expected a UUID like "749e6bbd-6a45-4440-beaa-ae5238bf06d8" or a full /a/chat/s/<id> URL`,
        );
    }
    return candidate.toLowerCase();
}

export async function isOnDeepSeek(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string' || !url) return false;
    try {
        const h = new URL(url).hostname;
        return h === 'deepseek.com' || h.endsWith('.deepseek.com');
    } catch {
        return false;
    }
}

export async function ensureOnDeepSeek(page) {
    if (await isOnDeepSeek(page)) return false;
    await page.goto(DEEPSEEK_URL);
    // Wait for the composer textarea instead of a fixed 3 s sleep. On the login
    // page it never mounts; swallow the timeout so callers (status / read /
    // history) can still inspect page state.
    try {
        await page.wait({ selector: TEXTAREA_SELECTOR, timeout: 8 });
    } catch {
        // Login or error page — downstream will see hasTextarea=false / empty results.
    }
    return true;
}

export async function getPageState(page) {
    return page.evaluate(`(() => {
        const url = window.location.href;
        const title = document.title;
        const textarea = document.querySelector('${TEXTAREA_SELECTOR}');
        const avatar = document.querySelector('img[src*="user-avatar"]');
        return {
            url,
            title,
            hasTextarea: !!textarea,
            isLoggedIn: !!avatar,
        };
    })()`);
}

export async function selectModel(page, modelName) {
    return page.evaluate(`(() => {
        var radios = document.querySelectorAll('div[role="radio"]');
        if (radios.length === 0) return { ok: false };
        var name = '${modelName}'.toLowerCase();
        var index = name === 'instant' ? 0 : name === 'expert' ? 1 : name === 'vision' ? 2 : -1;
        if (index < 0 || index >= radios.length) return { ok: false };
        var target = radios[index];
        var alreadySelected = target.getAttribute('aria-checked') === 'true';
        if (!alreadySelected) target.click();
        return { ok: true, toggled: !alreadySelected };
    })()`);
}

export async function setFeature(page, featureName, enabled) {
    // Match by position: DeepThink is the first toggle, Search is the second
    var index = featureName === 'DeepThink' ? 0 : 1;
    return page.evaluate(`(() => {
        var toggles = Array.from(document.querySelectorAll('.ds-toggle-button'));
        var btn = toggles[${index}];
        if (!btn) return { ok: false };
        var isActive = btn.classList.contains('ds-toggle-button--selected');
        if (${enabled} !== isActive) btn.click();
        return { ok: true, toggled: ${enabled} !== isActive };
    })()`);
}

export async function sendMessage(page, prompt) {
    const promptJson = JSON.stringify(prompt);
    return page.evaluate(`(async () => {
        const box = document.querySelector('${TEXTAREA_SELECTOR}');
        if (!box) return { ok: false, reason: 'textarea not found' };

        box.focus();
        box.value = '';
        document.execCommand('selectAll');
        document.execCommand('insertText', false, ${promptJson});
        await new Promise(r => setTimeout(r, 800));

        // Find the send button: last non-toggle button in the textarea's container
        var container = box.parentElement;
        while (container && !container.querySelector('div[role="button"]')) {
            container = container.parentElement;
        }
        if (container) {
            var btns = container.querySelectorAll('div[role="button"]:not(.ds-toggle-button)');
            var sendBtn = btns[btns.length - 1];
            if (sendBtn && sendBtn.getAttribute('aria-disabled') === 'false'
                && sendBtn.querySelectorAll('svg').length > 0) {
                sendBtn.click();
                return { ok: true };
            }
        }

        box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        return { ok: true, method: 'enter' };
    })()`);
}

export async function getBubbleCount(page) {
    const count = await page.evaluate(`(() => {
        return document.querySelectorAll('${MESSAGE_SELECTOR}').length;
    })()`);
    return count || 0;
}

// Parse thinking response using text as a fallback when DOM-level extraction
// is not available.  Does NOT split on \n\n — that heuristic silently corrupts
// multi-paragraph thinking or multi-paragraph answers.  Instead, everything
// after the header is treated as thinking content, and `response` stays empty
// until the caller provides a DOM-separated answer.
export function parseThinkingResponse(rawText) {
    if (!rawText) return null;

    // Match thinking header patterns: "Thought for X seconds" or "已思考（用时 X 秒）"
    const thinkHeaderMatch = rawText.match(/^(Thought for ([\d.]+) seconds?|已思考（用时 ([\d.]+) 秒）)\s*/);

    if (!thinkHeaderMatch) {
        // No thinking section found, return plain response
        return { response: rawText, thinking: null, thinking_time: null };
    }

    const thinkingTime = thinkHeaderMatch[2] || thinkHeaderMatch[3];
    const afterHeader = rawText.slice(thinkHeaderMatch[0].length);

    // Treat everything after the header as thinking.  The response will be
    // populated by the DOM-level extraction in waitForResponse().
    return {
        response: '',
        thinking: afterHeader.trim(),
        thinking_time: thinkingTime,
    };
}

export async function waitForResponse(page, baselineCount, prompt, timeoutMs, parseThinking = false) {
    const startTime = Date.now();
    let lastText = '';
    let stableCount = 0;

    while (Date.now() - startTime < timeoutMs) {
        await page.wait(3);

        let result;
        try {
            result = await page.evaluate(`(() => {
                const bubbles = document.querySelectorAll('${MESSAGE_SELECTOR}');
                const texts = Array.from(bubbles).map(b => (b.innerText || '').trim()).filter(Boolean);
                var last = texts[texts.length - 1] || '';

                // DOM-level thinking/response separation.
                // DeepSeek renders thinking in a collapsible container with a
                // distinct class (e.g. .ds-markdown--think or similar) and the
                // final answer in the main .ds-markdown region.  By querying
                // these separately we avoid any text-heuristic split.
                var thinkEl = null, answerEl = null, thinkTime = null;
                if (${parseThinking} && bubbles.length > 0) {
                    var lastBubble = bubbles[bubbles.length - 1];
                    // Thinking container — DeepSeek uses various class names;
                    // try common selectors.
                    thinkEl = lastBubble.querySelector('.ds-markdown--think')
                           || lastBubble.querySelector('[class*="think"]');
                    // Final answer container — the main markdown block that is
                    // NOT the thinking section.
                    var markdownEls = lastBubble.querySelectorAll('.ds-markdown');
                    for (var i = 0; i < markdownEls.length; i++) {
                        if (markdownEls[i] !== thinkEl
                            && !(thinkEl && thinkEl.contains(markdownEls[i]))
                            && !markdownEls[i].classList.contains('ds-markdown--think')) {
                            answerEl = markdownEls[i];
                        }
                    }
                    // Thinking time from the toggle/header element
                    var timeEl = lastBubble.querySelector('[class*="think"] ~ *')
                              || lastBubble.querySelector('.ds-thinking-header');
                    if (!timeEl) {
                        // Fallback: parse from raw text header
                        var m = last.match(/^(?:Thought for ([\\d.]+) seconds?|已思考（用时 ([\\d.]+) 秒）)/);
                        if (m) thinkTime = m[1] || m[2];
                    } else {
                        var tm = (timeEl.textContent || '').match(/([\\d.]+)/);
                        if (tm) thinkTime = tm[1];
                    }
                }

                return {
                    count: texts.length,
                    last: last,
                    // DOM-separated fields (null when not available)
                    thinkText: thinkEl ? (thinkEl.innerText || '').trim() : null,
                    answerText: answerEl ? (answerEl.innerText || '').trim() : null,
                    thinkTime: thinkTime,
                };
            })()`);
        } catch {
            continue;
        }

        if (!result) continue;

        const candidate = result.last;
        if (candidate && result.count > baselineCount && candidate !== prompt.trim()) {
            if (candidate === lastText) {
                stableCount++;
                if (stableCount >= 3) {
                    if (parseThinking) {
                        // Prefer DOM-level separation
                        if (result.thinkText != null || result.answerText != null) {
                            return {
                                thinking: result.thinkText || '',
                                response: result.answerText || '',
                                thinking_time: result.thinkTime || null,
                            };
                        }
                        // Fallback to text-header parsing (no \n\n split)
                        return parseThinkingResponse(candidate);
                    }
                    return candidate;
                }
            } else {
                stableCount = 0;
            }
            lastText = candidate;
        }
    }

    if (parseThinking && lastText) {
        return parseThinkingResponse(lastText);
    }
    return lastText || null;
}

export async function getVisibleMessages(page) {
    const result = await page.evaluate(`(() => {
        const msgs = document.querySelectorAll('${MESSAGE_SELECTOR}');
        return Array.from(msgs).map(m => {
            // User messages carry an extra hash-class alongside ds-message
            const isUser = m.className.split(/\\s+/).length > 2;
            return {
                Role: isUser ? 'user' : 'assistant',
                Text: (m.innerText || '').trim(),
            };
        }).filter(m => m.Text);
    })()`);
    return Array.isArray(result) ? result : [];
}

export async function getConversationList(page) {
    await ensureOnDeepSeek(page);
    // Expand sidebar if collapsed
    await page.evaluate(`(() => {
        if (document.querySelectorAll('a[href*="/a/chat/s/"]').length === 0) {
            const btn = document.querySelector('div[tabindex="0"][role="button"]');
            if (btn) btn.click();
        }
    })()`);
    for (let attempt = 0; attempt < 5; attempt++) {
        await page.wait(2);
        const items = await page.evaluate(`(() => {
            const items = [];
            const links = document.querySelectorAll('a[href*="/a/chat/s/"]');
            links.forEach((link, i) => {
                const title = (link.innerText || '').trim().split('\\n')[0].trim();
                const href = link.getAttribute('href') || '';
                const idMatch = href.match(/\\/s\\/([a-f0-9-]+)/);
                items.push({
                    Index: i + 1,
                    Id: idMatch ? idMatch[1] : href,
                    Title: title || '(untitled)',
                    Url: 'https://chat.deepseek.com' + href,
                });
            });
            return items;
        })()`);
        if (Array.isArray(items) && items.length > 0) return items;
    }
    return [];
}

/**
 * Pick the URL of the most recent non-pinned conversation, or the first overall
 * if every visible conversation is pinned.
 *
 * Used by `ask` when the workspace was recycled and we need to resume an
 * existing thread instead of opening a new chat. Polls the sidebar for up to
 * 10s and returns null if no conversation links surface in time, so callers
 * can fail fast instead of silently navigating to a fresh page.
 *
 * Pinned detection is text-based on the section header ("置顶" / "Pinned"),
 * because DeepSeek's CSS-module class names are randomized per build.
 */
export async function pickResumeUrl(page) {
    await page.evaluate(`(() => {
        if (document.querySelectorAll('a[href*="/a/chat/s/"]').length === 0) {
            const btn = document.querySelector('div[tabindex="0"][role="button"]');
            if (btn) btn.click();
        }
    })()`);
    for (let attempt = 0; attempt < 5; attempt++) {
        await page.wait(2);
        const url = await page.evaluate(`(() => {
            const links = document.querySelectorAll('a[href*="/a/chat/s/"]');
            if (links.length === 0) return null;
            const PINNED_HEADER = /^\\s*(置\\s*顶|Pinned)\\s*$/i;
            const isPinned = (link) => {
                const section = link.parentElement;
                const header = section && section.firstElementChild;
                if (!header || header === link) return false;
                return PINNED_HEADER.test((header.innerText || header.textContent || '').trim());
            };
            const target = Array.from(links).find((l) => !isPinned(l)) || links[0];
            const href = target.getAttribute('href') || '';
            return href ? 'https://chat.deepseek.com' + href : null;
        })()`);
        if (url) return url;
    }
    return null;
}

async function waitForFilePreview(page, fileName) {
    for (let attempt = 0; attempt < 8; attempt++) {
        await page.wait(2);
        const ready = await page.evaluate(`(() => {
            var name = ${JSON.stringify(fileName)};
            var hasFileName = Array.from(document.querySelectorAll('div'))
                .some(function(el) { return el.children.length === 0 && (el.textContent || '').trim() === name; });
            if (hasFileName) return true;
            // Vision mode shows an image thumbnail, not filename text. Require
            // a preview-like node here; send-button readiness is checked later.
            var box = document.querySelector('${TEXTAREA_SELECTOR}');
            if (!box) return false;
            var c = box.parentElement;
            while (c && !c.querySelector('div[role="button"]')) c = c.parentElement;
            if (!c) return false;
            return !!c.querySelector('img[src], canvas, video, [style*="background-image"], [class*="preview"], [class*="upload"]');
        })()`);
        if (ready) return true;
    }
    return false;
}

export async function sendWithFile(page, filePath, prompt) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const absPath = path.default.resolve(filePath);

    if (!fs.default.existsSync(absPath)) {
        return { ok: false, reason: `File not found: ${absPath}` };
    }

    const stats = fs.default.statSync(absPath);
    if (stats.size > 100 * 1024 * 1024) {
        return { ok: false, reason: `File too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Max: 100 MB` };
    }

    const fileName = path.default.basename(absPath);

    // Collapse sidebar to keep DOM simple for send button matching
    await page.evaluate(`(() => {
        if (document.querySelectorAll('a[href*="/a/chat/s/"]').length > 0) {
            const btn = document.querySelector('div[tabindex="0"][role="button"]');
            if (btn) btn.click();
        }
    })()`);
    await page.wait(0.5);

    let uploaded = false;
    if (page.setFileInput) {
        try {
            await page.setFileInput([absPath], 'input[type="file"]');
            uploaded = true;
        } catch (err) {
            const msg = String(err?.message || err);
            if (!msg.includes('Unknown action') && !msg.includes('not supported') && !msg.includes('Not allowed')) {
                throw err;
            }
        }
    }

    if (!uploaded) {
        const content = fs.default.readFileSync(absPath);
        const base64 = content.toString('base64');
        const fallbackResult = await page.evaluate(`(async () => {
            var binary = atob('${base64}');
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            var file = new File([bytes], ${JSON.stringify(fileName)});
            var dt = new DataTransfer();
            dt.items.add(file);

            var inp = document.querySelector('input[type="file"]');
            if (!inp) return { ok: false, reason: 'file input not found' };

            var propsKey = Object.keys(inp).find(function(k) { return k.startsWith('__reactProps$'); });
            if (!propsKey || typeof inp[propsKey].onChange !== 'function') {
                return { ok: false, reason: 'React onChange not found' };
            }

            inp.files = dt.files;
            // Use inp.files, not dt.files; assignment transfers ownership
            inp[propsKey].onChange({ target: { files: inp.files } });
            return { ok: true };
        })()`);
        if (fallbackResult && !fallbackResult.ok) return fallbackResult;
    }

    const ready = await waitForFilePreview(page, fileName);
    if (!ready) return { ok: false, reason: 'file preview did not appear' };

    // File preview appears immediately but send button stays disabled until
    // the server upload finishes. Wait for it.
    let sendEnabled = false;
    for (let tick = 0; tick < 15; tick++) {
        const enabled = await page.evaluate(`(() => {
            var box = document.querySelector('${TEXTAREA_SELECTOR}');
            if (!box) return false;
            var c = box.parentElement;
            while (c && !c.querySelector('div[role="button"]')) c = c.parentElement;
            if (!c) return false;
            var btns = c.querySelectorAll('div[role="button"]:not(.ds-toggle-button)');
            var last = btns[btns.length - 1];
            return !!(last && last.getAttribute('aria-disabled') === 'false');
        })()`);
        if (enabled) {
            sendEnabled = true;
            break;
        }
        await page.wait(1);
    }
    if (!sendEnabled) {
        return { ok: false, reason: 'send button did not enable after upload' };
    }

    return sendMessage(page, prompt);
}

// Retries on CDP "Promise was collected" errors caused by DeepSeek's SPA router transitions.
export async function withRetry(fn, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (err) {
            const msg = String(err?.message || err);
            if (i < retries && msg.includes('Promise was collected')) {
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            throw err;
        }
    }
}

export function parseBoolFlag(value) {
    if (typeof value === 'boolean') return value;
    return String(value ?? '').trim().toLowerCase() === 'true';
}
