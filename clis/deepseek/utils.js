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
        const radios = document.querySelectorAll('div[role="radio"]');
        for (const radio of radios) {
            const span = radio.querySelector('span');
            if (span && span.textContent.trim().toLowerCase() === '${modelName}'.toLowerCase()) {
                const alreadySelected = radio.getAttribute('aria-checked') === 'true';
                if (!alreadySelected) radio.click();
                return { ok: true, toggled: !alreadySelected };
            }
        }
        return { ok: false };
    })()`);
}

export async function setFeature(page, featureName, enabled) {
    return page.evaluate(`(() => {
        const btns = document.querySelectorAll('div[role="button"]');
        for (const btn of btns) {
            const span = btn.querySelector('span');
            if (span && span.textContent.trim() === '${featureName}') {
                const isActive = btn.classList.contains('ds-toggle-button--selected');
                if (${enabled} !== isActive) btn.click();
                return { ok: true, toggled: ${enabled} !== isActive };
            }
        }
        return { ok: false };
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

        // Fallback: find send button by its arrow-up SVG path
        const paths = document.querySelectorAll('svg path[d^="M8.3125"]');
        for (const p of paths) {
            const sendBtn = p.closest('div[role="button"]');
            if (sendBtn && sendBtn.getAttribute('aria-disabled') !== 'true') {
                sendBtn.click();
                return { ok: true, method: 'svg-match' };
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

export async function waitForResponse(page, baselineCount, prompt, timeoutMs) {
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
                if (stableCount >= 3) return candidate;
            } else {
                stableCount = 0;
            }
            lastText = candidate;
        }
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
    // Poll for sidebar history links to render
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

export async function attachFile(page, filePath) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const absPath = path.default.resolve(filePath);

    if (!fs.default.existsSync(absPath)) {
        return { ok: false, reason: `File not found: ${absPath}` };
    }

    const stats = fs.default.statSync(absPath);
    if (stats.size > 50 * 1024 * 1024) {
        return { ok: false, reason: `File too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Max: 50 MB` };
    }

    const content = fs.default.readFileSync(absPath);
    const base64 = content.toString('base64');
    const fileName = path.default.basename(absPath);

    const attachResult = await page.evaluate(`(async () => {
        const binary = atob('${base64}');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const file = new File([bytes], ${JSON.stringify(fileName)});
        const dt = new DataTransfer();
        dt.items.add(file);

        const inp = document.querySelector('input[type="file"]');
        if (!inp) return { ok: false, reason: 'file input element not found' };

        inp.files = dt.files;
        const propsKey = Object.keys(inp).find(k => k.startsWith('__reactProps$'));
        if (!propsKey || typeof inp[propsKey].onChange !== 'function') {
            return { ok: false, reason: 'React onChange handler not found on file input' };
        }
        inp[propsKey].onChange({ target: { files: dt.files } });
        return { ok: true };
    })()`);

    if (!attachResult?.ok) return attachResult;

    // Poll until file preview appears in the UI (confirms upload completed)
    for (let attempt = 0; attempt < 5; attempt++) {
        await page.wait(2);
        const verified = await page.evaluate(`(() => {
            const els = document.querySelectorAll('div');
            for (const el of els) {
                if (el.children.length === 0 && el.textContent.trim() === ${JSON.stringify(fileName)}) {
                    return true;
                }
            }
            return false;
        })()`);
        if (verified) return { ok: true, fileName };
    }

    return { ok: false, reason: 'File preview did not appear after upload' };
}

export async function attachAndSend(page, filePath, prompt) {
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

    const content = fs.default.readFileSync(absPath);
    const base64 = content.toString('base64');
    const fileName = path.default.basename(absPath);
    const promptJson = JSON.stringify(prompt);

    // Attach file, wait for upload, type prompt, and click send in a single evaluate
    // to avoid SPA navigation breaking the CDP context between separate calls.
    return page.evaluate(`(async () => {
        const binary = atob('${base64}');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const file = new File([bytes], ${JSON.stringify(fileName)});
        const dt = new DataTransfer();
        dt.items.add(file);

        const inp = document.querySelector('input[type="file"]');
        if (!inp) return { ok: false, reason: 'file input element not found' };

        inp.files = dt.files;
        const propsKey = Object.keys(inp).find(k => k.startsWith('__reactProps$'));
        if (!propsKey || typeof inp[propsKey].onChange !== 'function') {
            return { ok: false, reason: 'React onChange handler not found on file input' };
        }
        inp[propsKey].onChange({ target: { files: dt.files } });

        // Poll until file preview appears (upload complete)
        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const els = document.querySelectorAll('div');
            for (const el of els) {
                if (el.children.length === 0 && el.textContent.trim() === ${JSON.stringify(fileName)}) {
                    // File uploaded, now type and send
                    const box = document.querySelector('${TEXTAREA_SELECTOR}');
                    if (!box) return { ok: false, reason: 'textarea not found after file upload' };

                    box.focus();
                    document.execCommand('selectAll');
                    document.execCommand('insertText', false, ${promptJson});
                    await new Promise(r => setTimeout(r, 800));

                    const paths = document.querySelectorAll('svg path[d^="M8.3125"]');
                    for (const p of paths) {
                        const btn = p.closest('div[role="button"]');
                        if (btn && btn.getAttribute('aria-disabled') !== 'true') {
                            btn.click();
                            return { ok: true, method: 'file+send' };
                        }
                    }

                    box.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
                    }));
                    return { ok: true, method: 'file+enter' };
                }
            }
        }

        return { ok: false, reason: 'File preview did not appear after upload' };
    })()`);
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
