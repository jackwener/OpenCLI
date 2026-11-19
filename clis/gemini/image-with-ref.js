import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    GEMINI_DOMAIN,
    exportGeminiImages,
    getGeminiVisibleImageUrls,
    sendGeminiMessage,
    startNewGeminiChat,
    waitForGeminiImages,
} from './utils.js';

const UPLOAD_BUTTON_SELECTOR = 'button[aria-label="上传和工具"]';
const UPLOAD_MENUITEM_SELECTOR = '.cdk-overlay-container button[role="menuitem"]:not([aria-disabled="true"])';
const FILE_INPUT_SELECTOR = 'input[type=file]';

/**
 * Open the upload tools menu, click the first enabled "上传文件" (Upload files)
 * menu item, and inject the given files into the hidden `<input type=file>`
 * Angular Material creates.
 *
 * Each step uses a CSS selector (not a numeric snapshot ref) because the CDK
 * overlay menu is rendered at `<body>` root and is intentionally excluded from
 * `browser state` snapshots; numeric refs there are stale immediately.
 *
 * `page.click` falls back to CDP `Input.dispatchMouseEvent` (`tryNativeClick`),
 * which dispatches real pointer/mouse events — required for Angular Material
 * menu items that gate activation on a real mouse `mouseenter`. Older Gemini
 * builds also kept `aria-disabled=true` until that event landed, so the same
 * native-click path is what defeats the disabled state.
 *
 * Returns the upload result envelope from `page.uploadFiles`.
 */
export async function uploadReferenceFilesToGeminiComposer(page, files) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new ArgumentError('uploadReferenceFilesToGeminiComposer requires at least one file');
    }

    await page.click(UPLOAD_BUTTON_SELECTOR);
    await page.wait(0.5);
    await page.click(UPLOAD_MENUITEM_SELECTOR);
    await page.wait(0.5);

    const result = await page.uploadFiles(FILE_INPUT_SELECTOR, files);
    return result;
}

export const imageWithRefCommand = cli({
    site: 'gemini',
    name: 'image-with-ref',
    access: 'write',
    description: 'Upload reference images to the Gemini composer, then prompt for an image generation',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Image prompt to send to Gemini (sent after the references attach)' },
        {
            name: 'ref',
            default: '',
            help: 'Comma-separated list of local file paths to attach as reference images (e.g. "ref1.png,ref2.png").',
        },
        { name: 'rt', default: '1:1', help: 'Ratio shorthand for aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3)' },
        { name: 'timeout', type: 'int', required: false, default: 240, help: 'Max seconds to wait for image generation (default: 240)' },
        { name: 'new', default: 'false', help: 'Start a new chat before running (true/false, default: false)' },
    ],
    columns: ['status', 'files', 'link'],
    func: async (page, kwargs) => {
        const prompt = String(kwargs.prompt ?? '').trim();
        if (!prompt) {
            throw new ArgumentError('prompt is required');
        }
        const refsRaw = String(kwargs.ref ?? '').trim();
        const refs = refsRaw
            ? refsRaw.split(',').map((p) => p.trim()).filter(Boolean)
            : [];
        if (refs.length === 0) {
            throw new ArgumentError('At least one --ref <file> is required for image-with-ref (use comma-separated paths for multiple)');
        }
        const timeout = Number(kwargs.timeout ?? 240);
        if (!Number.isInteger(timeout) || timeout < 1) {
            throw new ArgumentError('--timeout must be a positive integer (seconds)');
        }
        const startFresh = String(kwargs.new ?? 'false').trim().toLowerCase() === 'true';

        if (startFresh) {
            await startNewGeminiChat(page);
        }

        const uploadResult = await uploadReferenceFilesToGeminiComposer(page, refs);
        if (!uploadResult?.uploaded) {
            throw new CommandExecutionError(
                `Reference upload failed: ${uploadResult?.reason || 'unknown reason'}`,
            );
        }

        const beforeUrls = await getGeminiVisibleImageUrls(page);
        await sendGeminiMessage(page, prompt);
        const urls = await waitForGeminiImages(page, beforeUrls, timeout);
        const link = await page.evaluate('window.location.href').catch(() => 'https://gemini.google.com/app');

        if (!urls.length) {
            return [{
                status: `⚠️ no-images (refs: ${uploadResult.files})`,
                files: `📎 ${uploadResult.file_names?.join(', ') ?? ''}`,
                link: `🔗 ${String(link || '')}`,
            }];
        }

        const assets = await exportGeminiImages(page, urls);
        return [{
            status: `🎨 generated (refs: ${uploadResult.files})`,
            files: `📎 ${uploadResult.file_names?.join(', ') ?? ''} + ${assets.length} result image${assets.length === 1 ? '' : 's'}`,
            link: `🔗 ${String(link || '')}`,
        }];
    },
});