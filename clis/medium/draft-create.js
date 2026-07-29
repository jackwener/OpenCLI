/**
 * Create a Medium story draft through the logged-in browser editor.
 *
 * Medium autosaves stories while they are being edited. This command waits
 * for that save acknowledgement and deliberately never opens the publish UI.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { fillStory, waitForEditor } from './publish.js';
import fs from 'node:fs';
import path from 'node:path';

const NEW_STORY_URL = 'https://medium.com/new-story';
const DRAFT_SAVE_TIMEOUT_SECONDS = 30;
const IMAGE_UPLOAD_TIMEOUT_SECONDS = 30;
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

function requireText(value, name, maxLength) {
    const text = String(value ?? '').trim();
    if (!text) throw new ArgumentError(`${name} is required`);
    if (text.length > maxLength) throw new ArgumentError(`${name} exceeds ${maxLength} characters`);
    return text;
}

function parseImagePaths(value) {
    if (!value) return [];
    const paths = String(value).split(',').map(item => item.trim()).filter(Boolean);
    if (paths.length > 20) throw new ArgumentError('Medium draft supports at most 20 images per command');
    return paths.map(imagePath => {
        const absolutePath = path.resolve(imagePath);
        if (!fs.existsSync(absolutePath)) throw new ArgumentError(`Image not found: ${absolutePath}`);
        if (!fs.statSync(absolutePath).isFile()) throw new ArgumentError(`Image is not a file: ${absolutePath}`);
        if (!IMAGE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
            throw new ArgumentError(`Unsupported Medium image format: ${absolutePath}`);
        }
        return absolutePath;
    });
}

async function uploadInlineImage(page, imagePath, index) {
    if (!page.setFileInput) {
        throw new CommandExecutionError(
            'Medium image drafts require Browser Bridge file upload support',
            'Use a browser mode that supports setFileInput.',
        );
    }

    const prepared = await page.evaluate(`(() => {
        const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
        if (!editor) return { ok: false, reason: 'Medium editor not found' };

        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);

        let input = Array.from(document.querySelectorAll('input[type="file"]')).find(el =>
            /image|photo|picture/.test(String(el.accept || '').toLowerCase()),
        );
        if (!input) {
            const visible = el => !!el && el.offsetParent !== null;
            const addButton = Array.from(document.querySelectorAll('button, [role="button"]')).find(el => {
                const label = [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent]
                    .filter(Boolean).join(' ').toLowerCase().trim();
                return visible(el) && (/add|insert|plus/.test(label) || label === '+');
            });
            addButton?.click();
            input = Array.from(document.querySelectorAll('input[type="file"]')).find(el =>
                /image|photo|picture/.test(String(el.accept || '').toLowerCase()),
            );
        }
        if (!input) {
            const visible = el => !!el && el.offsetParent !== null;
            const imageButton = Array.from(document.querySelectorAll('button, [role="button"]')).find(el => {
                const label = [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent]
                    .filter(Boolean).join(' ').toLowerCase();
                return visible(el) && /add (an )?image|insert image|image|photo|picture/.test(label);
            });
            imageButton?.click();
            input = Array.from(document.querySelectorAll('input[type="file"]')).find(el =>
                /image|photo|picture/.test(String(el.accept || '').toLowerCase()),
            );
        }
        if (!input) return { ok: false, reason: 'Medium image file input not found' };

        const marker = 'data-opencli-medium-image-upload';
        const value = String(Date.now()) + '-' + Math.random().toString(36).slice(2);
        input.setAttribute(marker, value);
        return {
            ok: true,
            selector: '[' + marker + '="' + value + '"]',
            imageCount: editor.querySelectorAll('img[src]').length,
        };
    })()`);
    if (!prepared?.ok) throw new CommandExecutionError(`Could not prepare Medium image ${index + 1}: ${prepared?.reason || 'unknown error'}`);

    try {
        await page.setFileInput([imagePath], prepared.selector);
    } catch (error) {
        throw new CommandExecutionError(`Medium image ${index + 1} upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    for (let attempt = 0; attempt < IMAGE_UPLOAD_TIMEOUT_SECONDS * 2; attempt++) {
        const result = await page.evaluate(`(baseline => {
            const editor = document.querySelector('[role="textbox"][contenteditable="true"]');
            const count = editor?.querySelectorAll('img[src]').length || 0;
            const text = String(document.body?.innerText || '').toLowerCase();
            if (/could not upload|failed to upload|upload failed|unsupported image/.test(text)) {
                return { ok: false, error: 'Medium reported an image upload failure' };
            }
            return { ok: count > baseline, count };
        })(${JSON.stringify(prepared.imageCount)})`);
        if (result?.ok) return;
        if (result?.error) throw new CommandExecutionError(result.error);
        if (attempt < IMAGE_UPLOAD_TIMEOUT_SECONDS * 2 - 1) await page.wait({ time: 0.5 });
    }
    throw new TimeoutError(`medium image ${index + 1} upload confirmation`, IMAGE_UPLOAD_TIMEOUT_SECONDS);
}

async function waitForDraftSave(page) {
    for (let attempt = 0; attempt < DRAFT_SAVE_TIMEOUT_SECONDS * 2; attempt++) {
        const result = await page.evaluate(`(() => {
            const url = location.href;
            const visible = el => !!el && el.offsetParent !== null;
            const labels = Array.from(document.querySelectorAll('[aria-label], [title], button, span, div'))
                .filter(visible)
                .map(el => [el.getAttribute('aria-label'), el.getAttribute('title'), el.innerText || el.textContent]
                    .filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim().toLowerCase())
                .filter(Boolean);
            const hasSaveAcknowledgement = labels.some(label => /(^|\\b)(saved|draft saved)(\\b|$)/.test(label));
            const pathname = new URL(url).pathname;
            const hasDraftEditorUrl = /\\/p\\/[^/]+\\/edit(?:\\/|$)/.test(pathname);
            const bodyText = String(document.body?.innerText || '').toLowerCase();
            if (/could not save|failed to save|save failed|try again/.test(bodyText)) {
                return { ok: false, error: 'Medium reported a draft save failure' };
            }
            return { ok: hasSaveAcknowledgement || hasDraftEditorUrl, url };
        })()`);
        if (result?.ok) return result.url;
        if (result?.error) throw new CommandExecutionError(result.error);
        if (attempt < DRAFT_SAVE_TIMEOUT_SECONDS * 2 - 1) await page.wait({ time: 0.5 });
    }
    throw new TimeoutError('medium draft save confirmation', DRAFT_SAVE_TIMEOUT_SECONDS);
}

export const createDraftCommand = cli({
    site: 'medium',
    name: 'draft-create',
    aliases: ['draft_create'],
    access: 'write',
    description: 'Create and confirm an autosaved Medium story draft',
    domain: 'medium.com',
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'foreground',
    siteSession: 'persistent',
    args: [
        { name: 'content', type: 'string', positional: true, required: true, help: 'Story body text' },
        { name: 'title', type: 'string', required: true, help: 'Story title' },
        { name: 'image', type: 'string', help: 'Local inline image path; separate multiple paths with commas (jpg/png/gif/webp/avif)' },
    ],
    columns: ['status', 'title', 'images', 'url'],
    func: async (page, kwargs) => {
        if (!page) throw new CommandExecutionError('Browser session required for medium draft-create');
        const title = requireText(kwargs.title, '--title', 500);
        const content = requireText(kwargs.content, '<content>', 100_000);
        const images = parseImagePaths(kwargs.image);

        await page.goto(NEW_STORY_URL);
        await waitForEditor(page);
        await fillStory(page, title, content);
        for (const [index, imagePath] of images.entries()) await uploadInlineImage(page, imagePath, index);
        const url = await waitForDraftSave(page);
        return [{ status: 'draft_created', title, images: images.length, url }];
    },
});
