/**
 * Weibo publish — post a new Weibo update via browser UI automation.
 *
 * Flow:
 *   1. Navigate to weibo.com and wait for the feed
 *   2. Check login state (getSelfUid)
 *   3. Click "发微博" button to open the inline compose editor
 *   4. Wait for textarea editor to appear
 *   5. Fill text content via CDP type
 *   6. Optionally upload images via CDP setFileInput
 *   7. Click the publish button
 *   8. Poll for success/failure feedback
 *
 * Usage:
 *   opencli weibo publish "Hello from OpenCLI! #opencli"  # publishes immediately
 *   opencli weibo publish "Check this out" --images /path/a.jpg,/path/b.jpg
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getSelfUid } from './utils.js';

const MAX_IMAGES = 9;
const UPLOAD_POLL_MS = 1500;
const UPLOAD_TIMEOUT_MS = 30_000;
const COMPOSE_POLL_MS = 300;
const COMPOSE_TIMEOUT_MS = 10_000;
const SUBMIT_POLL_MS = 500;
const SUBMIT_TIMEOUT_MS = 20_000;
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

// Weibo PC UI selectors
const TEXTAREA_SELECTOR = 'textarea._input_13iqr_8';
const FILE_INPUT_SELECTOR = 'input[type="file"][class*="_file_"]';

function validateText(text) {
    const t = String(text ?? '').trim();
    if (!t) throw new ArgumentError('weibo publish text cannot be empty');
    if (t.length > 2000) throw new ArgumentError('weibo publish text exceeds 2000 characters');
    return t;
}

function validateImagePaths(raw) {
    if (!raw) return [];
    const paths = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (paths.length > MAX_IMAGES) {
        throw new ArgumentError(`Too many images: ${paths.length} (max ${MAX_IMAGES})`);
    }
    return paths.map(p => {
        const absPath = path.resolve(p);
        const ext = path.extname(absPath).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) {
            throw new ArgumentError(`Unsupported image format "${ext}". Supported: jpg, png, gif, webp`);
        }
        const stat = fs.statSync(absPath, { throwIfNoEntry: false });
        if (!stat || !stat.isFile()) {
            throw new ArgumentError(`Not a valid file: ${absPath}`);
        }
        return absPath;
    });
}

cli({
    site: 'weibo',
    name: 'publish',
    description: 'Publish a new Weibo post immediately',
    domain: 'weibo.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        {
            name: 'text',
            type: 'string',
            required: true,
            positional: true,
            help: 'Weibo text content (max 2000 chars)',
        },
        {
            name: 'images',
            type: 'string',
            required: false,
            help: `Image paths, comma-separated, max ${MAX_IMAGES} (jpg/png/gif/webp)`,
        },
    ],
    columns: ['status', 'message', 'text'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for weibo publish');

        const text = validateText(kwargs.text);
        const absPaths = validateImagePaths(kwargs.images);

        // Step 1: Navigate to weibo.com and wait for feed to load
        await page.goto('https://weibo.com', { waitUntil: 'load', settleMs: 2000 });
        await page.wait({ time: 2 });

        // Step 2: Check login
        try {
            await getSelfUid(page);
        } catch (err) {
            if (err instanceof AuthRequiredError) throw err;
            throw new CommandExecutionError('Not logged into Weibo. Please login at weibo.com in your Chrome browser.');
        }

        // Step 3: Click "发微博" button to open inline compose editor
        const clickResult = await page.evaluate(`
            () => {
                const visible = el => !!el && el.offsetParent !== null && !el.disabled;
                const buttons = document.querySelectorAll('button[title="发微博"], button[title="写微博"]');
                for (const btn of buttons) {
                    if (visible(btn)) {
                        btn.click();
                        return { ok: true };
                    }
                }
                return { ok: false, message: 'Could not find 发微博 button' };
            }
        `);
        if (!clickResult?.ok) {
            throw new CommandExecutionError(clickResult?.message ?? 'Could not open compose editor.');
        }

        // Step 4: Wait for the textarea editor to appear (visible, not just in DOM)
        let editorFound = false;
        for (let i = 0; i < Math.ceil(COMPOSE_TIMEOUT_MS / COMPOSE_POLL_MS); i++) {
            const result = await page.evaluate(`
                () => {
                    const ta = document.querySelector('textarea._input_13iqr_8');
                    if (!ta) return { found: false };
                    const visible = ta.offsetParent !== null;
                    return { found: true, visible, rectTop: visible ? ta.getBoundingClientRect().top : -1 };
                }
            `);
            if (result?.found && result.visible && result.rectTop >= 0) {
                editorFound = true;
                break;
            }
            await page.wait({ time: COMPOSE_POLL_MS / 1000 });
        }
        if (!editorFound) {
            throw new CommandExecutionError('Weibo compose editor did not appear');
        }

        // Step 5: Upload images first (before text to avoid editor reset)
        if (absPaths.length > 0) {
            if (!page.setFileInput) {
                throw new CommandExecutionError('Browser extension does not support file upload. Please update the extension.');
            }

            // Find the file input
            const fileInputFound = await page.evaluate(`
                () => {
                    const input = document.querySelector('input[type="file"][class*="_file_"]');
                    return !!input;
                }
            `);
            if (!fileInputFound) {
                throw new CommandExecutionError('Could not find image file input on Weibo compose page. UI may have changed.');
            }

            await page.setFileInput(absPaths, FILE_INPUT_SELECTOR);

            // Wait for upload to complete
            let uploadResult = null;
            for (let i = 0; i < Math.ceil(UPLOAD_TIMEOUT_MS / UPLOAD_POLL_MS); i++) {
                await page.wait({ time: UPLOAD_POLL_MS / 1000 });
                uploadResult = await page.evaluateWithArgs(`
                    (() => {
                        const expectedCount = expected;
                        const uploading = document.querySelector('[class*="upload"], [class*="progress"]');
                        if (uploading && uploading.offsetParent !== null) return null;
                        const pics = document.querySelectorAll('img[class*="pic"], [class*="imgItem"], [class*="picture"] img');
                        if (pics.length >= expectedCount) return { ok: true, count: pics.length };
                        return null;
                    })()
                `, { expected: absPaths.length });
                if (uploadResult !== null) break;
            }

            if (!uploadResult?.ok) {
                throw new CommandExecutionError(uploadResult?.message ?? 'Image upload did not complete before timeout');
            }
        }

        // Step 6: Insert text using native DOM setter (preserves Weibo internal state)
        // IMPORTANT: Using nativeSetter preserves the textarea's reactive/internal state.
        // Direct ta.value= assignment bypasses Weibo's Vue reactivity and causes "undefined" content.
        const insertResult = await page.evaluateWithArgs(`
            (() => {
                const ta = document.querySelector('textarea._input_13iqr_8');
                if (!ta || ta.offsetParent === null) return { ok: false, message: 'textarea not visible' };
                ta.focus();
                const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
                if (nativeSetter) {
                    nativeSetter.call(ta, textContent);
                } else {
                    ta.value = textContent;
                }
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.dispatchEvent(new Event('change', { bubbles: true }));
                return { ok: true, valueLength: ta.value.length };
            })()
        `, { textContent: text });

        if (!insertResult?.ok) {
            throw new CommandExecutionError(insertResult?.message ?? 'Could not insert text.');
        }


        // Step 7: Click the send button inside the compose editor
        // Try 发送 first (compose editor's submit), then 发布 (fallback)
        await page.wait({ time: 0.5 });
        const publishResult = await page.evaluate(`
            () => {
                const visible = el => !!el && el.offsetParent !== null && !el.disabled;
                const labels = ['发送', '发布'];
                for (const label of labels) {
                    const allBtns = document.querySelectorAll('button, [role="button"]');
                    for (const btn of allBtns) {
                        const t = (btn.innerText || btn.textContent || '').trim();
                        if (t === label && visible(btn)) {
                            btn.click();
                            return { ok: true, label };
                        }
                    }
                }
                return { ok: false, message: 'Could not find send button' };
            }
        `);
        if (!publishResult?.ok) {
            throw new CommandExecutionError(publishResult?.message ?? 'Could not click publish.');
        }

        // Step 8: Wait for success/failure result
        let finalResult = null;
        for (let i = 0; i < Math.ceil(SUBMIT_TIMEOUT_MS / SUBMIT_POLL_MS); i++) {
            await page.wait({ time: SUBMIT_POLL_MS / 1000 });
            finalResult = await page.evaluateWithArgs(`
                (() => {
                    const successMarkers = ['发布成功', '已发布', '发送成功'];
                    const errorMarkers = ['发布失败', '发送失败', '内容违规', '请稍后再试', '频繁'];
                    for (const el of document.querySelectorAll('*')) {
                        if (el.children.length > 3) continue;
                        const txt = (el.innerText || '').trim();
                        if (!txt || txt.length > 100) continue;
                        for (const m of successMarkers) {
                            if (txt.includes(m) && (txt.includes('成功') || txt.includes('微博'))) {
                                return { ok: true, message: txt };
                            }
                        }
                        for (const m of errorMarkers) {
                            if (txt.includes(m)) {
                                return { ok: false, message: txt };
                            }
                        }
                    }
                    return null;
                })()
            `, { maxIterations: Math.ceil(SUBMIT_TIMEOUT_MS / SUBMIT_POLL_MS), currentIndex: i });
            if (finalResult !== null) break;
        }

        if (!finalResult) {
            throw new CommandExecutionError('Publish button clicked but result was unclear. Check Weibo manually.');
        }

        if (!finalResult.ok) {
            throw new CommandExecutionError(finalResult.message || 'Weibo publish failed');
        }

        return [{
            status: 'success',
            message: finalResult.message || 'Published successfully',
            text,
        }];
    },
});

export const __test__ = {
    validateText,
    validateImagePaths,
};
