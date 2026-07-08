import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const CLAUDE_DOMAIN = 'claude.ai';
export const CLAUDE_URL = 'https://claude.ai/new';
export const COMPOSER_SELECTOR = '[data-testid="chat-input"]';
export const MESSAGE_SELECTOR = '.font-claude-response';
export const MODEL_DROPDOWN_SELECTOR = '[data-testid="model-selector-dropdown"]';

const MODEL_DISPLAY_NAMES = {
    sonnet: 'Sonnet 4.6',
    opus: 'Opus 4.7',
    haiku: 'Haiku 4.5',
};

export async function isOnClaude(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    if (typeof url !== 'string' || !url) return false;
    try {
        const h = new URL(url).hostname;
        return h === CLAUDE_DOMAIN || h.endsWith(`.${CLAUDE_DOMAIN}`);
    } catch {
        return false;
    }
}

export async function ensureOnClaude(page) {
    if (await isOnClaude(page)) return false;
    await page.goto(CLAUDE_URL);
    // Wait for the composer textarea instead of a fixed 3 s sleep. On the login
    // page it never mounts; swallow the timeout so callers (read / detail /
    // send) can still inspect page state and produce typed errors.
    try {
        await page.wait({ selector: COMPOSER_SELECTOR, timeout: 8 });
    } catch {
        // Login or error page — downstream ensureClaudeLogin / ensureClaudeComposer surfaces a typed error.
    }
    return true;
}

export async function getPageState(page) {
    return page.evaluate(`(() => {
        var composer = document.querySelector('${COMPOSER_SELECTOR}');
        var userMenu = document.querySelector('[data-testid="user-menu-button"]');
        return {
            url: window.location.href,
            title: document.title,
            hasComposer: !!composer,
            isLoggedIn: !!userMenu,
        };
    })()`);
}

export async function ensureClaudeLogin(page, message = 'Claude requires a logged-in browser session.') {
    const state = await getPageState(page);
    if (!state.isLoggedIn) {
        throw new AuthRequiredError(CLAUDE_DOMAIN, message);
    }
    return state;
}

export async function ensureClaudeComposer(page, message = 'Claude composer is not available on the current page.') {
    const state = await ensureClaudeLogin(page, message);
    if (!state.hasComposer) {
        throw new CommandExecutionError(message);
    }
    return state;
}

export function requireNonEmptyPrompt(prompt, commandName) {
    const text = String(prompt ?? '').trim();
    if (!text) {
        throw new ArgumentError(
            `${commandName} prompt cannot be empty`,
            `Example: opencli ${commandName} "hello"`,
        );
    }
    return text;
}

export function requirePositiveInt(value, flagLabel, hint) {
    if (!Number.isInteger(value) || value < 1) {
        throw new ArgumentError(`${flagLabel} must be a positive integer`, hint);
    }
    return value;
}

export function requireConversationId(value) {
    const id = String(value ?? '').trim();
    if (!id) {
        throw new ArgumentError(
            'claude detail requires a conversation id',
            'Example: opencli claude detail 123e4567-e89b-12d3-a456-426614174000',
        );
    }
    return id;
}

export async function getVisibleMessages(page) {
    const result = await page.evaluate(`(() => {
        var nodes = document.querySelectorAll('[data-testid="user-message"], ${MESSAGE_SELECTOR}');
        var rows = [];
        Array.from(nodes).forEach(function(el) {
            var isUser = el.getAttribute('data-testid') === 'user-message';
            var raw = (el.innerText || '').trim();
            if (!isUser) {
                var parts = raw.split(/\\n\\n+/);
                while (parts.length > 1 && /^(Thought|View)\\b/i.test(parts[0])) parts.shift();
                raw = parts.join('\\n\\n').trim();
            }
            if (raw) rows.push({ role: isUser ? 'user' : 'assistant', text: raw });
        });
        return rows;
    })()`);
    if (!Array.isArray(result)) return [];
    return result.map(function(r, i) { return { Index: i, Role: r.role, Text: r.text }; });
}

export async function getConversationList(page) {
    if (!(await isOnClaude(page)) || !(await page.evaluate('window.location.href') || '').includes('/recents')) {
        await page.goto('https://claude.ai/recents');
        // Recents list mounts <a href="/chat/...">; an empty history is also
        // valid (returns []), so swallow the timeout instead of raising.
        try {
            await page.wait({ selector: 'a[href*="/chat/"]', timeout: 8 });
        } catch {
            // Empty history or login page — downstream evaluate returns [].
        }
    }
    const items = await page.evaluate(`(() => {
        var links = Array.from(document.querySelectorAll('a[href*="/chat/"]'));
        return links.map(function(link, i) {
            var href = link.getAttribute('href') || '';
            var idMatch = href.match(/\\/chat\\/([a-f0-9-]+)/);
            return {
                Index: i + 1,
                Id: idMatch ? idMatch[1] : href,
                Title: (link.innerText || '').trim().split('\\n')[0].trim() || '(untitled)',
                Url: href.startsWith('http') ? href : ('https://claude.ai' + href),
            };
        });
    })()`);
    return Array.isArray(items) ? items : [];
}

export async function selectModel(page, modelName) {
    const display = MODEL_DISPLAY_NAMES[String(modelName).toLowerCase()];
    if (!display) return { ok: false };

    const opened = await page.evaluate(`(() => {
        var trigger = document.querySelector('${MODEL_DROPDOWN_SELECTOR}');
        if (!trigger) return { ok: false };
        var label = trigger.getAttribute('aria-label') || '';
        if (label.indexOf(${JSON.stringify(display)}) >= 0) {
            return { ok: true, toggled: false };
        }
        trigger.click();
        return { ok: true, opened: true };
    })()`);

    if (!opened?.ok) return opened;
    if (!opened.opened) return opened;

    // Wait for the dropdown menu items to mount instead of a fixed 0.6 s sleep.
    try {
        await page.wait({ selector: 'div[role="menuitemradio"]', timeout: 3 });
    } catch {
        // Dropdown didn't open — next evaluate finds no target and returns { ok: false }.
    }

    return page.evaluate(`(() => {
        var items = Array.from(document.querySelectorAll('div[role="menuitemradio"]'));
        var target = items.find(function(el) { return (el.innerText || '').indexOf(${JSON.stringify(display)}) >= 0; });
        if (!target) return { ok: false };
        // Free-tier locked options carry an inline "Upgrade" button next to the label.
        var upgrade = target.querySelector('button');
        if (upgrade && (upgrade.innerText || '').toLowerCase().indexOf('upgrade') >= 0) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return { ok: false, upgrade: true };
        }
        var alreadySelected = target.getAttribute('aria-checked') === 'true';
        if (!alreadySelected) target.click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { ok: true, toggled: !alreadySelected };
    })()`);
}

export async function setAdaptiveThinking(page, enabled) {
    const opened = await page.evaluate(`(() => {
        var trigger = document.querySelector('${MODEL_DROPDOWN_SELECTOR}');
        if (!trigger) return { ok: false };
        trigger.click();
        return { ok: true };
    })()`);
    if (!opened?.ok) return { ok: false };

    // Wait for the dropdown menu items to mount instead of a fixed 0.6 s sleep.
    try {
        await page.wait({ selector: 'div[role="menuitem"]', timeout: 3 });
    } catch {
        // Dropdown didn't open — next evaluate finds no target and returns { ok: false }.
    }

    return page.evaluate(`(() => {
        var items = Array.from(document.querySelectorAll('div[role="menuitem"]'));
        var target = items.find(function(el) { return (el.innerText || '').indexOf('Adaptive thinking') >= 0; });
        if (!target) {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return { ok: false };
        }
        var isActive = target.getAttribute('aria-checked') === 'true';
        if (${enabled} !== isActive) target.click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { ok: true, toggled: ${enabled} !== isActive };
    })()`);
}

export async function sendMessage(page, prompt) {
    const promptJson = JSON.stringify(prompt);
    const composerReady = await page.evaluate(`(() => {
        var box = document.querySelector('${COMPOSER_SELECTOR}');
        if (!box) return false;
        box.focus();
        // ProseMirror editors hold content in nested <p>; clear via Range/delete
        // rather than .value or textContent, which the editor won't notice.
        var sel = window.getSelection();
        sel.removeAllRanges();
        var range = document.createRange();
        range.selectNodeContents(box);
        sel.addRange(range);
        document.execCommand('delete', false);
        return true;
    })()`);
    if (!composerReady) return { ok: false, reason: 'composer not found' };

    let typedNatively = false;
    if (page.nativeType) {
        try {
            await page.nativeType(prompt);
            typedNatively = true;
        } catch (err) {
            const msg = String(err?.message || err);
            if (!msg.includes('Unknown action') && !msg.includes('not supported')) throw err;
        }
    }
    if (!typedNatively) {
        await page.evaluate(`(() => {
            var box = document.querySelector('${COMPOSER_SELECTOR}');
            if (!box) return;
            box.focus();
            document.execCommand('insertText', false, ${promptJson});
        })()`);
    }

    await page.wait(1.2);

    return page.evaluate(`(() => {
        var ariaCandidates = [
            'button[aria-label="Send Message"]',
            'button[aria-label="Send message"]',
            'button[aria-label="Send"]',
            'button[aria-label*="Send"]',
        ];
        for (var i = 0; i < ariaCandidates.length; i++) {
            var btn = document.querySelector(ariaCandidates[i]);
            if (btn && !btn.disabled) { btn.click(); return { ok: true }; }
        }
        // Fallback: rightmost enabled button with an svg in the composer container.
        var box = document.querySelector('${COMPOSER_SELECTOR}');
        if (box) {
            var c = box.parentElement;
            for (var hop = 0; hop < 6 && c; hop++) {
                var btns = Array.from(c.querySelectorAll('button')).filter(function(b) { return !b.disabled && b.querySelector('svg'); });
                if (btns.length) { btns[btns.length - 1].click(); return { ok: true, method: 'fallback' }; }
                c = c.parentElement;
            }
        }
        var box2 = document.querySelector('${COMPOSER_SELECTOR}');
        if (box2) {
            box2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            return { ok: true, method: 'enter' };
        }
        return { ok: false, reason: 'send button not found' };
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
                var bubbles = document.querySelectorAll('${MESSAGE_SELECTOR}');
                // Adaptive thinking renders "Thought process" labels at the top
                // of the response (often duplicated for the expand/collapse widget).
                // Strip them so the row value is the actual answer text.
                var texts = Array.from(bubbles).map(function(b) {
                    var raw = (b.innerText || '').trim();
                    // Drop leading paragraphs that are widget labels:
                    //   "Thought process" / "Thought for Xs" — Adaptive thinking expand widget
                    //   "View uploaded image" / "View attachment" — file thumbnail label
                    // These render twice (collapsed + expanded) and are followed by a blank line.
                    var parts = raw.split(/\\n\\n+/);
                    while (parts.length > 1 && /^(Thought|View)\\b/i.test(parts[0])) parts.shift();
                    return parts.join('\\n\\n').trim();
                }).filter(Boolean);
                return {
                    count: texts.length,
                    last: texts[texts.length - 1] || '',
                    streaming: !!document.querySelector('[data-is-streaming="true"]'),
                };
            })()`);
        } catch {
            continue;
        }

        if (!result) continue;

        const candidate = result.last;
        if (!candidate || candidate === prompt.trim()) continue;
        if (result.count <= baselineCount) continue;
        if (result.streaming) {
            lastText = candidate;
            stableCount = 0;
            continue;
        }

        if (candidate === lastText) {
            stableCount++;
            if (stableCount >= 3) return candidate;
        } else {
            stableCount = 0;
            lastText = candidate;
        }
    }

    return lastText || null;
}

async function waitForFilePreview(page, fileName) {
    for (let attempt = 0; attempt < 12; attempt++) {
        await page.wait(1);
        const ready = await page.evaluate(`(() => {
            // Claude renders attachments as data-testid="file-thumbnail" cards with
            // a sibling Remove button. Either signal indicates the file took.
            if (document.querySelector('[data-testid="file-thumbnail"]')) return true;
            var removeBtn = Array.from(document.querySelectorAll('button'))
                .find(function(b) { return (b.getAttribute('aria-label') || '') === 'Remove'; });
            return !!removeBtn;
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
    if (stats.size > 30 * 1024 * 1024) {
        return { ok: false, reason: `File too large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Max: 30 MB` };
    }

    const fileName = path.default.basename(absPath);

    let uploaded = false;
    if (page.setFileInput) {
        try {
            // Upload via CDP so the file content does not cross the daemon body
            // limit, then trigger React's controlled onChange manually because
            // CDP assigns .files without firing the synthetic event React listens for.
            await page.setFileInput([absPath], 'input[data-testid="file-upload"]');
            const fired = await page.evaluate(`(() => {
                var inp = document.querySelector('input[data-testid="file-upload"]');
                if (!inp) return { ok: false, reason: 'file input not found' };
                var propsKey = Object.keys(inp).find(function(k) { return k.startsWith('__reactProps$'); });
                if (propsKey && typeof inp[propsKey].onChange === 'function') {
                    inp[propsKey].onChange({ target: { files: inp.files } });
                    return { ok: true, via: 'react' };
                }
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true, via: 'native' };
            })()`);
            if (!fired?.ok) return fired;
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

            var inp = document.querySelector('input[data-testid="file-upload"]');
            if (!inp) return { ok: false, reason: 'file input not found' };

            var propsKey = Object.keys(inp).find(function(k) { return k.startsWith('__reactProps$'); });
            if (!propsKey || typeof inp[propsKey].onChange !== 'function') {
                return { ok: false, reason: 'React onChange not found' };
            }

            inp.files = dt.files;
            inp[propsKey].onChange({ target: { files: inp.files } });
            return { ok: true };
        })()`);
        if (fallbackResult && !fallbackResult.ok) return fallbackResult;
    }

    const ready = await waitForFilePreview(page, fileName);
    if (!ready) return { ok: false, reason: 'file preview did not appear' };

    return sendMessage(page, prompt);
}

// Retries on CDP "Promise was collected" errors caused by Claude SPA route changes.
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
