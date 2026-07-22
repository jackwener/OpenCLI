import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

const PINTEREST_DOMAIN = 'www.pinterest.com';
const PINTEREST_HOME_URL = `https://${PINTEREST_DOMAIN}/`;
const DEFAULT_PROFILE_SLUG = process.env.OPENCLI_PINTEREST_PROFILE || 'imyuqlee';
const IMAGE_SELECTOR = 'input[type="file"]';
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MIME_BY_EXTENSION = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};
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

function boardToPathSegment(board) {
    const aliases = new Map([
        ['buiness', 'business'],
    ]);
    const key = String(board || '').trim().toLowerCase();
    const normalized = (aliases.get(key) || key)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!normalized) throw new ArgumentError('pinterest create-pin board cannot be converted to a board URL');
    return normalized;
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

async function getPinterestProfileSlug(page) {
    const result = await page.evaluate(`(() => {
        const extract = href => {
            const raw = String(href || '').trim();
            if (!raw) return '';
            try {
                const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, location.origin);
                const first = url.pathname.split('/').filter(Boolean)[0] || '';
                return first && !first.startsWith('_') ? decodeURIComponent(first) : '';
            } catch {
                return '';
            }
        };
        const profileLink = document.querySelector('a[aria-label="Your profile"][href]');
        const fromProfileLink = extract(profileLink?.getAttribute('href') || profileLink?.href);
        if (fromProfileLink) return { ok: true, profile: fromProfileLink };
        const accountLinks = Array.from(document.querySelectorAll('a[href^="/"], a[href*="pinterest.com/"]'))
            .map(a => extract(a.getAttribute('href') || a.href))
            .filter(Boolean)
            .filter(slug => !['pin', 'pin-builder', 'pin-creation-tool', 'ideas', 'business', 'settings', 'engagement'].includes(slug));
        const profile = accountLinks.find(Boolean);
        return profile ? { ok: true, profile } : { ok: false, message: 'Pinterest profile link not found' };
    })()`);
    if (result?.ok && result.profile) return result.profile;
    if (DEFAULT_PROFILE_SLUG) return DEFAULT_PROFILE_SLUG;
    throw new CommandExecutionError(result?.message || 'Pinterest profile link not found');
}

async function openPinCreationFromBoard(page, board) {
    const profile = await getPinterestProfileSlug(page);
    const boardPath = boardToPathSegment(board);
    await page.goto(`https://${PINTEREST_DOMAIN}/${encodeURIComponent(profile)}/${boardPath}/`, { waitUntil: 'load', settleMs: 3000 });
    await page.wait({ time: 2 });
    await requireLoggedIn(page);

    let result;
    for (let i = 0; i < 6; i++) {
        result = await page.evaluate(OPEN_BOARD_PIN_CREATION_SCRIPT);
        if (result?.ok) {
            await page.wait({ time: 2 });
            return result;
        }
        await page.wait({ time: result?.needsWait ? 1 : 0.5 });
    }
    throw new CommandExecutionError(result?.message || `Pinterest Pin creation entry not found for board: ${board}`);
}

const OPEN_BOARD_PIN_CREATION_SCRIPT = `(() => {
    const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const textOf = el => String(el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || '').trim();
    if (/\\/pin-creation-tool\\/?$/.test(location.pathname) || document.querySelector('input[type="file"]')) {
        return { ok: true, action: 'already-open' };
    }

    const menuItems = Array.from(document.querySelectorAll('button, [role="menuitem"], [data-test-id="Create Story Pin"]'))
        .filter(visible);
    const pinEntry = menuItems.find(el => {
        const text = textOf(el).toLowerCase();
        const testid = String(el.getAttribute('data-test-id') || '').toLowerCase();
        return testid === 'create story pin' || text === 'pin' || text.includes('create pin');
    });
    if (pinEntry) {
        pinEntry.scrollIntoView({ block: 'center', inline: 'center' });
        pinEntry.click();
        return { ok: true, action: 'pin' };
    }

    const openers = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible);
    const opener = openers.find(el => {
        const text = textOf(el).toLowerCase();
        const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
        return aria.includes('create a pin or add a section')
            || aria.includes('create pin')
            || text === 'create a pin or add a section';
    });
    if (opener) {
        opener.scrollIntoView({ block: 'center', inline: 'center' });
        opener.click();
        return { ok: false, needsWait: true, action: 'menu' };
    }
    return { ok: false, needsWait: true, message: 'Pinterest board create Pin menu not found' };
})()`;

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

function isRecoverableFileInputError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    return lower.includes('not allowed')
        || lower.includes('unknown action')
        || lower.includes('not supported')
        || lower.includes('setfileinput returned no count');
}

async function uploadImageViaDataTransfer(page, imagePath) {
    const ext = path.extname(imagePath).toLowerCase();
    const file = {
        name: path.basename(imagePath),
        mime: MIME_BY_EXTENSION[ext] || 'image/jpeg',
        base64: fs.readFileSync(imagePath).toString('base64'),
    };
    const result = await page.evaluate(`(() => {
        const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
        const input = inputs.find(el => {
            const accept = String(el.getAttribute('accept') || '').toLowerCase();
            return visible(el) || accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png') || accept.includes('.webp') || accept.includes('.gif') || !accept;
        });
        if (!input) return { ok: false, error: 'No image file input found on page' };

        const file = ${JSON.stringify(file)};
        const bin = atob(file.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: file.mime });
        const dt = new DataTransfer();
        dt.items.add(new File([blob], file.name, { type: file.mime }));

        let assigned = false;
        try {
            Object.defineProperty(input, 'files', { value: dt.files, writable: false, configurable: true });
            assigned = input.files && input.files.length === 1;
        } catch (e) {
            try {
                const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
                if (descriptor && descriptor.set) {
                    descriptor.set.call(input, dt.files);
                    assigned = input.files && input.files.length === 1;
                }
            } catch (e2) {}
        }
        if (!assigned) return { ok: false, error: 'Could not assign files to input' };

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, count: input.files.length };
    })()`);
    if (!result?.ok) {
        throw new CommandExecutionError(`Pinterest image upload fallback failed: ${result?.error || 'unknown error'}`);
    }
    return result;
}

async function uploadImage(page, imagePath) {
    if (page.setFileInput) {
        try {
            await page.setFileInput([imagePath], IMAGE_SELECTOR);
            return;
        } catch (err) {
            if (!isRecoverableFileInputError(err)) throw err;
        }
    }
    await uploadImageViaDataTransfer(page, imagePath);
}

async function fillPinterestField(page, field, value) {
    if (!value) return;
    let result;
    for (let i = 0; i < 3; i++) {
        result = await page.evaluateWithArgs
            ? await page.evaluateWithArgs(FILL_FIELD_SCRIPT, { field, value })
            : await page.evaluate(`{ const field = ${JSON.stringify(field)}; const value = ${JSON.stringify(value)}; ${FILL_FIELD_SCRIPT} }`);
        if (!result?.needsWait) break;
        await page.wait({ time: 0.7 });
    }
    if (!result?.ok) {
        throw new CommandExecutionError(result?.message || `Failed to fill Pinterest ${field}`);
    }
}

async function fillOptionalPinterestField(page, field, value) {
    if (!value) return;
    const result = await page.evaluateWithArgs
        ? await page.evaluateWithArgs(FILL_FIELD_SCRIPT, { field, value })
        : await page.evaluate(`{ const field = ${JSON.stringify(field)}; const value = ${JSON.stringify(value)}; ${FILL_FIELD_SCRIPT} }`);
    if (!result?.ok && !String(result?.message || '').toLowerCase().includes('field not found')) {
        throw new CommandExecutionError(result?.message || `Failed to fill Pinterest ${field}`);
    }
}

async function fillPinterestDescriptionField(page, value) {
    if (!value) return;
    if (page.fillText) {
        await expandPinterestDescriptionField(page);
        const filled = await page.fillText('[aria-label="Describe your Pin"][contenteditable="true"]', value);
        if (filled?.verified) return;
        throw new CommandExecutionError(`Pinterest description did not retain value: ${filled?.actual || ''}`);
    }

    let located;
    for (let i = 0; i < 5; i++) {
        located = await page.evaluateWithArgs
            ? await page.evaluateWithArgs(PREPARE_DESCRIPTION_FIELD_SCRIPT, { value })
            : await page.evaluate(`{ const value = ${JSON.stringify(value)}; ${PREPARE_DESCRIPTION_FIELD_SCRIPT} }`);
        if (!located?.needsWait) break;
        await page.wait({ time: 0.8 });
    }
    if (!located?.ok) {
        throw new CommandExecutionError(located?.message || 'Pinterest description field not found');
    }

    let result;
    if (located.kind === 'contenteditable' && page.insertText) {
        await page.insertText(value);
        result = await page.evaluateWithArgs
            ? await page.evaluateWithArgs(VERIFY_DESCRIPTION_FIELD_SCRIPT, { value })
            : await page.evaluate(`{ const value = ${JSON.stringify(value)}; ${VERIFY_DESCRIPTION_FIELD_SCRIPT} }`);
    } else {
        result = await page.evaluateWithArgs
            ? await page.evaluateWithArgs(SET_DESCRIPTION_FIELD_SCRIPT, { value })
            : await page.evaluate(`{ const value = ${JSON.stringify(value)}; ${SET_DESCRIPTION_FIELD_SCRIPT} }`);
    }
    if (!result?.ok) {
        throw new CommandExecutionError(result?.message || `Pinterest description did not retain value: ${result?.actual || ''}`);
    }
}

async function expandPinterestDescriptionField(page) {
    let result;
    for (let i = 0; i < 5; i++) {
        result = await page.evaluate(EXPAND_DESCRIPTION_FIELD_SCRIPT);
        if (result?.ok) return;
        await page.wait({ time: result?.needsWait ? 0.8 : 0.5 });
    }
    throw new CommandExecutionError(result?.message || 'Pinterest description field not found');
}

const EXPAND_DESCRIPTION_FIELD_SCRIPT = `(() => {
    const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const editor = document.querySelector('[aria-label="Describe your Pin"][contenteditable="true"]');
    if (editor && visible(editor)) return { ok: true };
    const container = document.querySelector('[data-test-id="storyboard-description-field-container"]');
    if (!container || !visible(container)) return { ok: false, message: 'Pinterest description container not found' };
    const opener = Array.from(container.querySelectorAll('button, [role="button"], [tabindex]'))
        .filter(visible)
        .find(Boolean);
    if (!opener) return { ok: false, needsWait: true, message: 'Pinterest description opener not found' };
    opener.scrollIntoView({ block: 'center', inline: 'center' });
    opener.click();
    return { ok: false, needsWait: true, action: 'open-description' };
})()`;

const PREPARE_DESCRIPTION_FIELD_SCRIPT = `(() => {
    const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const container = document.querySelector('[data-test-id="storyboard-description-field-container"]');
    if (!container || !visible(container)) return { ok: false, message: 'Pinterest description container not found' };

    const editables = Array.from(container.querySelectorAll('textarea, [contenteditable="true"], input:not([type]), input[type="text"]'))
        .filter(el => visible(el) && !el.disabled);
    const editable = editables.find(el => {
        const type = String(el.getAttribute('type') || '').toLowerCase();
        return !['file', 'checkbox', 'radio', 'hidden', 'url'].includes(type);
    });
    if (!editable) {
        const opener = Array.from(container.querySelectorAll('button, [role="button"], [tabindex]'))
            .filter(visible)
            .find(Boolean);
        if (opener) {
            opener.scrollIntoView({ block: 'center', inline: 'center' });
            opener.click();
            return { ok: false, needsWait: true, action: 'open-description' };
        }
        return { ok: false, needsWait: true, message: 'Pinterest description input not ready' };
    }

    editable.setAttribute('data-opencli-pinterest-description', 'true');
    editable.scrollIntoView({ block: 'center', inline: 'center' });
    editable.focus();

    if (editable.getAttribute('contenteditable') === 'true') {
        editable.textContent = '';
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
        try {
            editable.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: value, inputType: 'insertText' }));
        } catch {
            editable.dispatchEvent(new Event('beforeinput', { bubbles: true }));
        }
        return { ok: true, kind: 'contenteditable' };
    }

    const proto = editable.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(editable, '');
    else editable.value = '';
    editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    return { ok: true, kind: editable.tagName === 'TEXTAREA' ? 'textarea' : 'input' };
})()`;

const VERIFY_DESCRIPTION_FIELD_SCRIPT = `(() => {
    const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
    const editable = document.querySelector('[data-opencli-pinterest-description="true"]');
    if (!editable) return { ok: false, message: 'Pinterest description field lost focus' };
    try {
        editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    } catch {
        editable.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editable.dispatchEvent(new Event('change', { bubbles: true }));
    const actual = normalize(editable.innerText || editable.textContent || editable.value || '');
    return actual === normalize(value)
        ? { ok: true, actual }
        : { ok: false, actual, message: 'Pinterest description did not retain value' };
})()`;

const SET_DESCRIPTION_FIELD_SCRIPT = `(() => {
    const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
    const editable = document.querySelector('[data-opencli-pinterest-description="true"]');
    if (!editable) return { ok: false, message: 'Pinterest description field lost focus' };
    const proto = editable.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(editable, value);
    else editable.value = value;
    try {
        editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    } catch {
        editable.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editable.dispatchEvent(new Event('change', { bubbles: true }));
    const actual = normalize(editable.value || editable.innerText || editable.textContent || '');
    return actual === normalize(value)
        ? { ok: true, actual }
        : { ok: false, actual, message: 'Pinterest description did not retain value' };
})()`;

const FILL_FIELD_SCRIPT = `(() => {
    const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const normalize = text => String(text || '').trim().toLowerCase();
    const editableSelector = 'input, textarea, [contenteditable="true"]';
    const validEditable = el => visible(el)
        && !el.disabled
        && !['file', 'checkbox', 'radio', 'hidden'].includes(normalize(el.getAttribute('type')));
    const scopedContainers = {
        title: ['storyboard-title-field-container'],
        description: ['storyboard-description-field-container'],
        link: ['storyboard-selector-link'],
    };
    const fieldLabels = {
        title: ['title', 'add your title', 'storyboard-selector-title', '标题'],
        description: ['description', 'describe your pin', 'tell everyone what your pin is about', 'add a detailed description', 'storyboard-selector-description', '说明', '描述'],
        link: ['link', 'destination link', 'add a destination link', 'add a link', 'website', 'websitefield', 'storyboard-selector-link', '链接'],
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

    function findScopedEditable() {
        let sawContainer = false;
        for (const testid of scopedContainers[field] || []) {
            const container = document.querySelector('[data-test-id="' + CSS.escape(testid) + '"]');
            if (!container || !visible(container)) continue;
            sawContainer = true;
            const scoped = Array.from(container.querySelectorAll(editableSelector)).filter(validEditable);
            if (scoped.length > 0) return scoped[0];
            const trigger = Array.from(container.querySelectorAll('button, [role="button"]')).filter(visible)[0];
            if (trigger) {
                trigger.scrollIntoView({ block: 'center', inline: 'center' });
                trigger.click();
                return { needsWait: true, message: 'field opening: ' + field };
            }
        }
        return sawContainer ? { scopedMissing: true, message: 'field not found in scoped container: ' + field } : null;
    }

    let el = findScopedEditable();
    if (el?.needsWait) return el;
    if (el?.scopedMissing) return { ok: false, message: el.message };
    const elements = Array.from(document.querySelectorAll(editableSelector)).filter(validEditable);
    if (!el) el = elements.find(candidateMatches);
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
    let result;
    for (let i = 0; i < 30; i++) {
        result = await page.evaluate(MARK_PUBLISH_BUTTON_SCRIPT);
        if (result?.ok) break;
        if (!result?.needsWait) break;
        await page.wait({ time: 0.5 });
    }
    if (!result?.ok) throw new CommandExecutionError(result?.message || 'Pinterest publish button not found');
    if (!page.nativeClick || !Number.isFinite(result.x) || !Number.isFinite(result.y)) {
        throw new CommandExecutionError('OpenCLI native click is unavailable for Pinterest publish button');
    }
    await page.nativeClick(Math.round(result.x), Math.round(result.y));
    await page.wait({ time: 1 });
    const stillClickable = await page.evaluate(MARK_PUBLISH_BUTTON_SCRIPT);
    if (stillClickable?.ok && Number.isFinite(stillClickable.x) && Number.isFinite(stillClickable.y)) {
        await page.nativeClick(Math.round(stillClickable.x), Math.round(stillClickable.y));
    }
    return result;
}

const MARK_PUBLISH_BUTTON_SCRIPT = `(() => {
    const publishXPath = '/html/body/div[1]/div[1]/div/div[3]/div/div/div/div[2]/div[3]/div/div/div[2]/div[3]/div[2]/div/button';
    const visible = el => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const normalize = text => String(text || '').replace(/\\s+/g, ' ').trim();
    const textOf = el => normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
    const fromXPath = document.evaluate(
        publishXPath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
    ).singleNodeValue;
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(visible)
        .map(el => ({ el, text: textOf(el), rect: el.getBoundingClientRect() }))
        .filter(item => item.text);
    const exactLabels = new Set(['Publish', '发布']);
    const exact = buttons.filter(item => exactLabels.has(item.text));
    const candidates = exact.length > 0
        ? exact
        : buttons.filter(item => /^(publish|发布)$/i.test(item.text));
    const target = fromXPath && visible(fromXPath)
        ? { el: fromXPath, text: textOf(fromXPath) || 'Publish', rect: fromXPath.getBoundingClientRect(), source: 'xpath' }
        : candidates.sort((a, b) => (a.rect.top - b.rect.top) || (b.rect.left - a.rect.left))[0];
    if (!target) {
        return {
            ok: false,
            needsWait: true,
            message: 'Publish button not found',
            candidates: buttons.map(item => item.text).slice(0, 20),
        };
    }

    const btn = target.el;
    const style = getComputedStyle(btn);
    const disabled = !!btn.disabled
        || btn.getAttribute('aria-disabled') === 'true'
        || btn.closest('[aria-disabled="true"]')
        || style.pointerEvents === 'none';
    if (disabled) {
        return { ok: false, needsWait: true, message: 'Publish button is disabled', label: target.text };
    }

    document.querySelectorAll('[data-opencli-pinterest-publish="true"]')
        .forEach(el => el.removeAttribute('data-opencli-pinterest-publish'));
    btn.setAttribute('data-opencli-pinterest-publish', 'true');
    btn.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = btn.getBoundingClientRect();
    return {
        ok: true,
        label: target.text,
        source: target.source || 'text',
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
    };
})()`;

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
        const imagePath = normalizeImagePath(kwargs.image);
        const board = normalizeText(kwargs.board, 'board', { required: true, max: 180 });
        const title = normalizeText(kwargs.title, 'title', { max: 100 });
        const description = normalizeText(kwargs.description, 'description', { max: 800 });
        const link = validateLink(kwargs.link);
        const altText = normalizeText(kwargs['alt-text'], 'alt-text', { max: 500 });
        const timeoutSeconds = normalizeTimeout(kwargs.timeout);

        await page.goto(PINTEREST_HOME_URL, { waitUntil: 'load', settleMs: 2000 });
        await page.wait({ time: 1 });
        await requireLoggedIn(page);
        await openPinCreationFromBoard(page, board);
        await waitForImageInput(page, Math.min(timeoutSeconds, 30));
        await uploadImage(page, imagePath);
        await waitForUploadPreview(page, Math.min(timeoutSeconds, 90));

        await fillPinterestField(page, 'title', title);
        await fillPinterestDescriptionField(page, description);
        await fillPinterestField(page, 'link', link);
        await fillOptionalPinterestField(page, 'altText', altText);
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
