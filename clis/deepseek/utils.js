export const DEEPSEEK_DOMAIN = 'chat.deepseek.com';
export const DEEPSEEK_URL = 'https://chat.deepseek.com/';
export const TEXTAREA_SELECTOR = 'textarea[placeholder*="DeepSeek"]';
export const MESSAGE_SELECTOR = '.ds-message';

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
    if (!(await isOnDeepSeek(page))) {
        await page.goto(DEEPSEEK_URL);
        await page.wait(3);
    }
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
        var isFirst = '${modelName}'.toLowerCase() === 'instant';
        if (!isFirst && radios.length < 2) return { ok: false };
        var target = isFirst ? radios[0] : radios[radios.length - 1];
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

        const btns = document.querySelectorAll('div[role="button"]');
        for (const btn of btns) {
            if (btn.getAttribute('aria-disabled') === 'false') {
                const svgs = btn.querySelectorAll('svg');
                if (svgs.length > 0 && btn.closest('div')?.querySelector('textarea')) {
                    btn.click();
                    return { ok: true };
                }
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

    // Split by double newline to separate thinking content from final answer
    // The thinking content typically ends with a blank line before the response
    const parts = afterHeader.split(/\n\n+/);

    if (parts.length < 2) {
        // If no clear separation, treat everything after header as thinking
        return {
            response: '',
            thinking: afterHeader.trim(),
            thinking_time: thinkingTime,
        };
    }

    // First part(s) are thinking, last part is the response
    const thinking = parts.slice(0, -1).join('\n\n').trim();
    const response = parts[parts.length - 1].trim();

    return {
        response,
        thinking,
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
                return { count: texts.length, last: texts[texts.length - 1] || '' };
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
                const titleEl = link.querySelector('div');
                const title = titleEl ? titleEl.textContent.trim() : '';
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

async function waitForFilePreview(page, fileName) {
    for (let attempt = 0; attempt < 8; attempt++) {
        await page.wait(2);
        const ready = await page.evaluate(`(() => {
            const name = ${JSON.stringify(fileName)};
            return Array.from(document.querySelectorAll('div'))
                .some((el) => el.children.length === 0 && (el.textContent || '').trim() === name);
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
            if (!msg.includes('Unknown action') && !msg.includes('not supported')) {
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
            inp[propsKey].onChange({ target: { files: dt.files } });
            return { ok: true };
        })()`);
        if (fallbackResult && !fallbackResult.ok) return fallbackResult;
    }

    const ready = await waitForFilePreview(page, fileName);
    if (!ready) return { ok: false, reason: 'file preview did not appear' };

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
