import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

const PINTEREST_DOMAIN = 'www.pinterest.com';
const CREATE_PIN_URL = 'https://www.pinterest.com/pin-builder/';
const IMAGE_SELECTOR = 'input[type="file"]';
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const DEFAULT_TIMEOUT = 90;

function normalizeText(value, label, { required = false, max = 0 } = {}) {
    const text = String(value ?? '').trim();
    if (required && !text) throw new ArgumentError(`pinterest create-pin ${label} cannot be empty`);
    if (max > 0 && text.length > max) {
        throw new ArgumentError(`pinterest create-pin ${label} must be <= ${max} characters`);
    }
    return text;
}

function normalizeTimeout(value) {
    const n = Number(value ?? DEFAULT_TIMEOUT);
    if (!Number.isInteger(n) || n <= 0) throw new ArgumentError('pinterest create-pin timeout must be a positive integer');
    if (n < 15) throw new ArgumentError('pinterest create-pin timeout must be >= 15');
    if (n > 300) throw new ArgumentError('pinterest create-pin timeout must be <= 300');
    return n;
}

function normalizeImagePath(raw) {
    const image = normalizeText(raw, 'image', { required: true });
    const absPath = path.resolve(image);
    const ext = path.extname(absPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
        throw new ArgumentError(`Unsupported image format "${ext || '(none)'}". Supported: jpg, jpeg, png, webp, gif`);
    }
    const stat = fs.statSync(absPath, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) throw new ArgumentError(`Not a valid image file: ${absPath}`);
    return absPath;
}

function validateLink(raw) {
    const link = normalizeText(raw, 'link');
    if (!link) return '';
    let parsed;
    try {
        parsed = new URL(link);
    } catch {
        throw new ArgumentError('pinterest create-pin link must be a valid http(s) URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ArgumentError('pinterest create-pin link must be a valid http(s) URL');
    }
    return parsed.href;
}

async function requireLoggedIn(page) {
    const state = await page.evaluate(`(() => {
        const url = location.href;
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const loginSignals = [
            'log in',
            'sign up',
            'signup',
            'login',
            '登录',
        ];
        const hasCreateSurface = !!document.querySelector('input[type="file"], textarea, [contenteditable="true"], [data-test-id*="pin"]');
        const isAuthPage = /\\/login|\\/signup|\\/business\\/create/.test(location.pathname);
        const asksLogin = loginSignals.some(signal => bodyText.includes(signal)) && !hasCreateSurface;
        return {
            url,
            loggedIn: !isAuthPage && !asksLogin,
            hasCreateSurface,
        };
    })()`);
    if (!state?.loggedIn) {
        throw new AuthRequiredError(PINTEREST_DOMAIN, 'Pinterest login required before creating a Pin');
    }
}

async function waitForImageInput(page, timeoutSeconds) {
    const attempts = Math.ceil(timeoutSeconds * 1000 / 500);
    for (let i = 0; i < attempts; i++) {
        const result = await page.evaluate(`(() => {
            const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
            const input = inputs.find(el => {
                const accept = String(el.getAttribute('accept') || '').toLowerCase();
                return accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png') || accept.includes('.webp') || accept.includes('.gif') || !accept;
            });
            return input ? { ok: true, selector: 'input[type="file"]' } : { ok: false };
        })()`);
        if (result?.ok) return result;
        await page.wait({ time: 0.5 });
    }
    throw new TimeoutError('pinterest image upload input', timeoutSeconds);
}

async function waitForUploadPreview(page, timeoutSeconds) {
    const attempts = Math.ceil(timeoutSeconds * 1000 / 1000);
    for (let i = 0; i < attempts; i++) {
        const result = await page.evaluate(`(() => {
            const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
            const images = Array.from(document.querySelectorAll('img')).filter(img => {
                const src = String(img.currentSrc || img.src || '');
                const alt = String(img.alt || '').toLowerCase();
                return visible(img) && (src.startsWith('blob:') || src.startsWith('data:') || alt.includes('image') || alt.includes('pin'));
            });
            const busyText = (document.body?.innerText || '').toLowerCase();
            if (images.length > 0) return { ok: true, count: images.length };
            if (/upload failed|couldn't upload|上传失败|不支持|too large/.test(busyText)) {
                return { ok: false, message: 'Pinterest reported image upload failure' };
            }
            return { ok: false };
        })()`);
        if (result?.ok) return result;
        if (result?.message) throw new CommandExecutionError(result.message);
        await page.wait({ time: 1 });
    }
    throw new TimeoutError('pinterest image upload', timeoutSeconds);
}

async function fillPinterestField(page, field, value) {
    if (!value) return;
    const result = await page.evaluateWithArgs
        ? await page.evaluateWithArgs(FILL_FIELD_SCRIPT, { field, value })
        : await page.evaluate(`{ const field = ${JSON.stringify(field)}; const value = ${JSON.stringify(value)}; ${FILL_FIELD_SCRIPT} }`);
    if (!result?.ok) {
        throw new CommandExecutionError(result?.message || `Failed to fill Pinterest ${field}`);
    }
}

const FILL_FIELD_SCRIPT = `(() => {
    const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const normalize = text => String(text || '').trim().toLowerCase();
    const fieldLabels = {
        title: ['title', 'add your title', '标题'],
        description: ['description', 'tell everyone what your pin is about', 'add a detailed description', '说明', '描述'],
        link: ['link', 'destination link', 'add a destination link', 'website', '链接'],
        altText: ['alt text', 'alternative text', 'alt', '替代文本'],
    };
    const labels = fieldLabels[field] || [field];

    function candidateMatches(el) {
        const attrs = [
            el.getAttribute('aria-label'),
            el.getAttribute('placeholder'),
            el.getAttribute('name'),
            el.getAttribute('data-test-id'),
            el.id,
        ].map(normalize);
        if (attrs.some(attr => labels.some(label => attr.includes(label)))) return true;
        const labelText = el.id
            ? normalize(document.querySelector('label[for="' + CSS.escape(el.id) + '"]')?.textContent)
            : '';
        return labels.some(label => labelText.includes(label));
    }

    const elements = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'))
        .filter(el => visible(el) && !el.disabled && el.getAttribute('type') !== 'file');
    let el = elements.find(candidateMatches);
    if (!el && field === 'title') el = elements.find(node => node.tagName === 'INPUT' || node.tagName === 'TEXTAREA');
    if (!el && field === 'description') el = elements.find(node => node.tagName === 'TEXTAREA' || node.getAttribute('contenteditable') === 'true');
    if (!el && field === 'link') el = elements.find(node => normalize(node.getAttribute('type')) === 'url');
    if (!el) return { ok: false, message: 'field not found: ' + field };

    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus();
    if (el.getAttribute('contenteditable') === 'true') {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, value);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    } else {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, value);
        else el.value = value;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const actual = el.getAttribute('contenteditable') === 'true' ? el.innerText : el.value;
    return String(actual || '').trim() ? { ok: true, field } : { ok: false, message: 'field did not retain value: ' + field };
})()`;

async function chooseBoard(page, board) {
    let result = await page.evaluateWithArgs
        ? await page.evaluateWithArgs(CHOOSE_BOARD_SCRIPT, { board })
        : await page.evaluate(`{ const board = ${JSON.stringify(board)}; ${CHOOSE_BOARD_SCRIPT} }`);
    if (result?.needsWait) {
        await page.wait({ time: 1 });
        result = await page.evaluateWithArgs
            ? await page.evaluateWithArgs(CHOOSE_BOARD_SCRIPT, { board })
            : await page.evaluate(`{ const board = ${JSON.stringify(board)}; ${CHOOSE_BOARD_SCRIPT} }`);
    }
    if (!result?.ok) {
        throw new CommandExecutionError(result?.message || `Pinterest board not found: ${board}`);
    }
}

const CHOOSE_BOARD_SCRIPT = `(() => {
    const wanted = String(board || '').trim().toLowerCase();
    const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const textOf = el => String(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || '').trim();
    const choices = Array.from(document.querySelectorAll('button, [role="button"], [role="option"], [role="menuitem"], [data-test-id*="board"], [data-test-id*="Board"]'))
        .filter(visible);
    const match = choices.find(el => {
        const text = textOf(el).toLowerCase();
        return text === wanted || text.includes(wanted);
    });
    if (match) {
        match.scrollIntoView({ block: 'center', inline: 'center' });
        match.click();
        return { ok: true, board: textOf(match) || board };
    }
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], [aria-haspopup], [data-test-id*="board"], [data-test-id*="Board"]'))
        .filter(visible);
    const opener = candidates.find(el => {
        const text = textOf(el).toLowerCase();
        const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
        return text.includes('choose a board') || text.includes('select board') || text.includes('board') || aria.includes('board') || text.includes('选择图板') || text.includes('看板');
    });
    if (opener) {
        opener.click();
        return { ok: false, needsWait: true };
    }
    return { ok: false, message: 'Board not found: ' + board };
})()`;

async function clickPublish(page) {
    const result = await page.evaluate(`(() => {
        const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const labels = ['publish', 'save', 'create', '发布', '保存', '创建'];
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
        const btn = buttons.find(el => {
            const text = String(el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
            if (!text) return false;
            return labels.some(label => text === label || text.includes(label));
        });
        if (!btn) return { ok: false, message: 'Publish button not found' };
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return { ok: false, message: 'Publish button is disabled' };
        btn.scrollIntoView({ block: 'center', inline: 'center' });
        btn.click();
        return { ok: true, label: String(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '').trim() };
    })()`);
    if (!result?.ok) throw new CommandExecutionError(result?.message || 'Pinterest publish button not found');
}

async function waitForPublishResult(page, timeoutSeconds) {
    const attempts = Math.ceil(timeoutSeconds * 1000 / 1000);
    for (let i = 0; i < attempts; i++) {
        await page.wait({ time: 1 });
        const result = await page.evaluate(`(() => {
            const url = location.href;
            if (/\\/pin\\/\\d+/.test(url)) return { ok: true, url };
            const text = String(document.body?.innerText || '');
            const lower = text.toLowerCase();
            if (lower.includes('published') || lower.includes('saved to') || lower.includes('created') || text.includes('已发布') || text.includes('已保存')) {
                const link = Array.from(document.querySelectorAll('a[href*="/pin/"]'))
                    .map(a => a.href)
                    .find(Boolean);
                return { ok: true, url: link || url };
            }
            if (/error|try again|couldn't publish|could not publish|failed|错误|失败/.test(lower)) {
                return { ok: false, message: 'Pinterest reported a publish failure' };
            }
            return { ok: false };
        })()`);
        if (result?.ok) return result;
        if (result?.message) throw new CommandExecutionError(result.message);
    }
    throw new TimeoutError('pinterest publish confirmation', timeoutSeconds);
}

cli({
    site: 'pinterest',
    name: 'create-pin',
    access: 'write',
    description: 'Create and publish a Pinterest Pin from the logged-in browser session',
    domain: PINTEREST_DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    args: [
        { name: 'image', type: 'string', required: true, help: 'Local image path (jpg/jpeg/png/webp/gif)' },
        { name: 'board', type: 'string', required: true, help: 'Pinterest board name to publish into' },
        { name: 'title', type: 'string', help: 'Pin title' },
        { name: 'description', type: 'string', help: 'Pin description' },
        { name: 'link', type: 'string', help: 'Destination link URL' },
        { name: 'alt-text', type: 'string', help: 'Image alt text, when Pinterest exposes the field' },
        { name: 'timeout', type: 'int', default: DEFAULT_TIMEOUT, help: 'Max seconds to wait for upload and publish confirmation (15-300)' },
    ],
    columns: ['status', 'board', 'title', 'url'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for pinterest create-pin');
        if (!page.setFileInput) {
            throw new CommandExecutionError('Browser Bridge file upload support is required for pinterest create-pin');
        }

        const imagePath = normalizeImagePath(kwargs.image);
        const board = normalizeText(kwargs.board, 'board', { required: true, max: 180 });
        const title = normalizeText(kwargs.title, 'title', { max: 100 });
        const description = normalizeText(kwargs.description, 'description', { max: 800 });
        const link = validateLink(kwargs.link);
        const altText = normalizeText(kwargs['alt-text'], 'alt-text', { max: 500 });
        const timeoutSeconds = normalizeTimeout(kwargs.timeout);

        await page.goto(CREATE_PIN_URL, { waitUntil: 'load', settleMs: 3000 });
        await page.wait({ time: 2 });
        await requireLoggedIn(page);
        await waitForImageInput(page, Math.min(timeoutSeconds, 30));
        await page.setFileInput([imagePath], IMAGE_SELECTOR);
        await waitForUploadPreview(page, Math.min(timeoutSeconds, 90));

        await fillPinterestField(page, 'title', title);
        await fillPinterestField(page, 'description', description);
        await fillPinterestField(page, 'link', link);
        await fillPinterestField(page, 'altText', altText);
        await chooseBoard(page, board);
        await page.wait({ time: 1 });
        await clickPublish(page);
        const published = await waitForPublishResult(page, timeoutSeconds);

        return [{
            status: 'published',
            board,
            title: title || null,
            url: published.url || null,
        }];
    },
});
