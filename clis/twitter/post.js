import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const MAX_IMAGES = 4;
const UPLOAD_POLL_MS = 500;
const UPLOAD_TIMEOUT_MS = 30_000;
const COMPOSER_POLL_MS = 250;
const COMPOSER_TIMEOUT_MS = 10_000;
const SUBMIT_POLL_MS = 500;
const SUBMIT_TIMEOUT_MS = 15_000;
const COMPOSE_URL = 'https://x.com/compose/post';
const FILE_INPUT_SELECTOR = 'input[type="file"][data-testid="fileInput"]';
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function validateImagePaths(raw) {
    const paths = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (paths.length > MAX_IMAGES) {
        throw new CommandExecutionError(`Too many images: ${paths.length} (max ${MAX_IMAGES})`);
    }
    return paths.map(p => {
        const absPath = path.resolve(p);
        const ext = path.extname(absPath).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) {
            throw new CommandExecutionError(`Unsupported image format "${ext}". Supported: jpg, png, gif, webp`);
        }
        const stat = fs.statSync(absPath, { throwIfNoEntry: false });
        if (!stat || !stat.isFile()) {
            throw new CommandExecutionError(`Not a valid file: ${absPath}`);
        }
        return absPath;
    });
}

function isUnsupportedInsertTextError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    return lower.includes('unknown action') || lower.includes('not supported') || lower.includes('inserttext returned no inserted flag');
}

async function focusComposer(page) {
    return page.evaluate(`(() => {
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]'));
        const box = boxes.find(visible) || boxes[0];
        if (!box) return { ok: false, message: 'Could not find the tweet composer text area. Are you logged in?' };
        box.focus();
        return { ok: true };
    })()`);
}

async function verifyComposerText(page, text) {
    const iterations = Math.ceil(COMPOSER_TIMEOUT_MS / COMPOSER_POLL_MS);
    return page.evaluate(`(async () => {
        const expected = ${JSON.stringify(text)};
        const normalize = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const normalizedExpected = normalize(expected);
        for (let i = 0; i < ${JSON.stringify(iterations)}; i++) {
            const box = document.querySelector('[data-testid="tweetTextarea_0"]');
            const actual = box ? (box.innerText || box.textContent || '') : '';
            if (box && normalize(actual).includes(normalizedExpected)) return { ok: true };
            await new Promise(r => setTimeout(r, ${JSON.stringify(COMPOSER_POLL_MS)}));
        }
        const box = document.querySelector('[data-testid="tweetTextarea_0"]');
        return {
            ok: false,
            message: 'Could not verify tweet text in the composer after typing.',
            actualText: box ? (box.innerText || box.textContent || '') : ''
        };
    })()`);
}

async function insertComposerText(page, text) {
    const focusResult = await focusComposer(page);
    if (!focusResult?.ok) return focusResult;

    const nativeInserters = [
        page.nativeType?.bind(page),
        page.insertText?.bind(page),
    ].filter(Boolean);

    for (const insert of nativeInserters) {
        try {
            // Native CDP Input.insertText updates Twitter/X's Draft.js editor much more
            // reliably than synthetic paste/input events. Prefer the Page CDP helper
            // when available because older Browser Bridge insert-text can report
            // inserted while the editor state does not change after media upload.
            await insert(text);
            const verified = await verifyComposerText(page, text);
            if (verified?.ok) return verified;
        }
        catch (err) {
            if (!isUnsupportedInsertTextError(err)) throw err;
            // Older Browser Bridge versions do not expose this insertion path; try the next one.
        }
    }

    return page.evaluate(`(async () => {
        try {
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]'));
            const box = boxes.find(visible) || boxes[0];
            if (!box) return { ok: false, message: 'Could not find the tweet composer text area. Are you logged in?' };
            const textToInsert = ${JSON.stringify(text)};
            const normalize = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            box.focus();
            if (!document.execCommand('insertText', false, textToInsert)) {
                const dt = new DataTransfer();
                dt.setData('text/plain', textToInsert);
                box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            }
            await new Promise(r => setTimeout(r, 500));
            const actual = box.innerText || box.textContent || '';
            if (normalize(actual).includes(normalize(textToInsert))) return { ok: true };
            return { ok: false, message: 'Could not verify tweet text in the composer after typing.', actualText: actual };
        } catch (e) { return { ok: false, message: String(e) }; }
    })()`);
}

async function waitForImageUpload(page, expectedCount) {
    const iterations = Math.ceil(UPLOAD_TIMEOUT_MS / UPLOAD_POLL_MS);
    return page.evaluate(`(async () => {
        const expected = ${JSON.stringify(expectedCount)};
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        for (let i = 0; i < ${JSON.stringify(iterations)}; i++) {
            await new Promise(r => setTimeout(r, ${JSON.stringify(UPLOAD_POLL_MS)}));
            const attachments = document.querySelector('[data-testid="attachments"]');
            const previewCount = Math.max(
                attachments ? attachments.querySelectorAll('[role="group"], img, video').length : 0,
                document.querySelectorAll('[data-testid="tweetPhoto"], img[src^="blob:"], video[src^="blob:"]').length,
                Array.from(document.querySelectorAll('button,[role="button"]')).filter((el) =>
                    /remove media|remove image|remove/i.test((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || ''))
                ).length
            );
            const button = Array.from(document.querySelectorAll('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'))
                .find((el) => visible(el));
            const buttonReady = !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
            if (previewCount >= expected && buttonReady) return { ok: true, previewCount };
        }
        return { ok: false, message: 'Image upload timed out (${UPLOAD_TIMEOUT_MS / 1000}s).' };
    })()`);
}

async function submitTweet(page, text) {
    const clickResult = await page.evaluate(`(async () => {
        try {
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const buttons = Array.from(document.querySelectorAll('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'));
            const btn = buttons.find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
            if (!btn) return { ok: false, message: 'Tweet button is disabled or not found.' };
            btn.click();
            return { ok: true };
        } catch (e) { return { ok: false, message: String(e) }; }
    })()`);
    if (!clickResult?.ok) return clickResult;

    const iterations = Math.ceil(SUBMIT_TIMEOUT_MS / SUBMIT_POLL_MS);
    return page.evaluate(`(async () => {
        const expected = ${JSON.stringify(text)};
        const normalize = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const expectedText = normalize(expected);
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        for (let i = 0; i < ${JSON.stringify(iterations)}; i++) {
            await new Promise(r => setTimeout(r, ${JSON.stringify(SUBMIT_POLL_MS)}));
            const toasts = Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"]'))
                .filter((el) => visible(el));
            const successToast = toasts.find((el) => /sent|posted|your post was sent|your tweet was sent/i.test(el.textContent || ''));
            if (successToast) return { ok: true, message: 'Tweet posted successfully.' };
            const alert = toasts.find((el) => /failed|error|try again|not sent|could not/i.test(el.textContent || ''));
            if (alert) return { ok: false, message: (alert.textContent || 'Tweet failed to post.').trim() };

            const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]')).filter(visible);
            const composerStillHasText = boxes.some((box) => normalize(box.innerText || box.textContent || '').includes(expectedText));
            const hasMedia = !!document.querySelector('[data-testid="attachments"], [data-testid="tweetPhoto"]')
                || document.querySelectorAll('img[src^="blob:"], video[src^="blob:"]').length > 0;
            if (!composerStillHasText && !hasMedia) {
                return { ok: true, message: 'Tweet posted successfully.' };
            }
        }
        return { ok: false, message: 'Tweet submission did not complete before timeout.' };
    })()`);
}

cli({
    site: 'twitter',
    name: 'post',
    description: 'Post a new tweet/thread',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', type: 'string', required: true, positional: true, help: 'The text content of the tweet' },
        { name: 'images', type: 'string', required: false, help: 'Image paths, comma-separated, max 4 (jpg/png/gif/webp)' },
    ],
    columns: ['status', 'message', 'text'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter post');

        // Validate images upfront before any browser interaction.
        const absPaths = kwargs.images ? validateImagePaths(String(kwargs.images)) : [];
        const text = String(kwargs.text ?? '');

        // The current X standalone composer is /compose/post. It keeps a single,
        // visible composer and is the same route used by the reply command.
        await page.goto(COMPOSE_URL, { waitUntil: 'load', settleMs: 2500 });
        await page.wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });

        // Attach media before inserting text. Uploading media after Draft.js has
        // text can re-render/reset the editor, causing image-only posts.
        if (absPaths.length > 0) {
            if (!page.setFileInput) {
                throw new CommandExecutionError('Browser extension does not support file upload. Please update the extension.');
            }
            await page.wait({ selector: FILE_INPUT_SELECTOR, timeout: 20 });
            await page.setFileInput(absPaths, FILE_INPUT_SELECTOR);
            const uploadState = await waitForImageUpload(page, absPaths.length);
            if (!uploadState?.ok) {
                return [{ status: 'failed', message: uploadState?.message ?? `Image upload timed out (${UPLOAD_TIMEOUT_MS / 1000}s).`, text }];
            }
        }

        // Insert and verify the text after media upload so text + images are in
        // the final Draft.js composer state immediately before clicking Post.
        const typeResult = await insertComposerText(page, text);
        if (!typeResult?.ok) {
            return [{ status: 'failed', message: typeResult?.message ?? 'Could not type tweet text.', text }];
        }

        await page.wait(1);
        const result = await submitTweet(page, text);
        return [{ status: result?.ok ? 'success' : 'failed', message: result?.message ?? 'Tweet failed to post.', text }];
    }
});
