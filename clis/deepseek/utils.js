export const DEEPSEEK_DOMAIN = 'chat.deepseek.com';
export const DEEPSEEK_URL = 'https://chat.deepseek.com/';
export const TEXTAREA_SELECTOR = 'textarea[placeholder*="DeepSeek"]';
export const MESSAGE_SELECTOR = '.ds-message';

export async function isOnDeepSeek(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string' || !url) return false;
    try {
        return new URL(url).hostname.endsWith('deepseek.com');
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
                if (radio.getAttribute('aria-checked') !== 'true') radio.click();
                return { selected: true };
            }
        }
        return { selected: false };
    })()`);
}

export async function enableFeature(page, featureName) {
    return page.evaluate(`(() => {
        const btns = document.querySelectorAll('div[role="button"]');
        for (const btn of btns) {
            const span = btn.querySelector('span');
            if (span && span.textContent.trim() === '${featureName}') {
                const isActive = btn.classList.length > 1;
                if (!isActive) btn.click();
                return { enabled: true, wasAlreadyActive: isActive };
            }
        }
        return { enabled: false };
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
    return page.evaluate(`(() => {
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
