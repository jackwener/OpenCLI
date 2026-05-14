import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { activateChatGPTImageTool, clearChatGPTDraft, getChatGPTVisibleImageUrls, normalizeBooleanFlag, parseChatGPTConversationId, prepareChatGPTImagePaths, resolveAspectAriaLabel, sendChatGPTMessage, setChatGPTImageAspect, waitForChatGPTImages, getChatGPTImageAssets, uploadChatGPTImages } from './utils.js';

const CHATGPT_DOMAIN = 'chatgpt.com';

function extFromMime(mime) {
    if (mime.includes('png')) return '.png';
    if (mime.includes('webp')) return '.webp';
    if (mime.includes('gif')) return '.gif';
    return '.jpg';
}

function displayPath(filePath) {
    const home = os.homedir();
    return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

export function resolveOutputDir(value) {
    const raw = String(value || '').trim();
    if (!raw) return path.join(os.homedir(), 'Pictures', 'chatgpt');
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    return path.resolve(raw);
}

export function nextAvailablePath(dir, baseName, ext, existsSync = fs.existsSync) {
    let candidate = path.join(dir, `${baseName}${ext}`);
    for (let index = 1; existsSync(candidate); index += 1) {
        candidate = path.join(dir, `${baseName}_${index}${ext}`);
    }
    return candidate;
}

export function parseImagePaths(value) {
    if (Array.isArray(value)) {
        return value.flatMap(item => parseImagePaths(item));
    }
    return String(value ?? '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function buildPrompt(prompt, imageCount) {
    if (imageCount > 0) {
        return `Edit the attached image${imageCount === 1 ? '' : 's'}: ${prompt}`;
    }
    return `Generate an image of: ${prompt}`;
}

async function currentChatGPTLink(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    return typeof url === 'string' && url ? url : 'https://chatgpt.com';
}

export const imageCommand = cli({
    site: 'chatgpt',
    name: 'image',
    access: 'write',
    description: 'Generate images with ChatGPT web and save them locally',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Image prompt to send to ChatGPT' },
        { name: 'image', help: 'Local image path to attach before prompting; comma-separated paths are supported' },
        { name: 'op', help: 'Output directory (default: ~/Pictures/chatgpt)' },
        { name: 'sd', type: 'boolean', default: false, help: 'Skip download shorthand; only show ChatGPT link' },
        { name: 'timeout', type: 'int', required: false, default: 240, help: 'Max seconds for the overall command (default: 240)' },
        { name: 'conv', help: 'Continue an existing conversation by id or /c/<id> URL (default: start a new conversation)' },
        { name: 'aspect', help: 'Image aspect ratio: auto, 1:1, 3:4, 9:16, 4:3, 16:9 (aliases: square, portrait, story, landscape, widescreen). Default: auto' },
    ],
    columns: ['status', 'file', 'link'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const imagePaths = parseImagePaths(kwargs.image);
        const outputDir = resolveOutputDir(kwargs.op);
        const skipDownloadRaw = kwargs.sd;
        const skipDownload = skipDownloadRaw === '' || skipDownloadRaw === true || normalizeBooleanFlag(skipDownloadRaw);
        const timeout = kwargs.timeout;
        if (!Number.isInteger(timeout) || timeout < 1) {
            throw new ArgumentError('--timeout must be a positive integer (seconds)');
        }

        const convInput = kwargs.conv === undefined || kwargs.conv === null ? '' : String(kwargs.conv).trim();
        const conversationId = convInput ? parseChatGPTConversationId(convInput) : '';
        const aspectAriaLabel = resolveAspectAriaLabel(kwargs.aspect);

        const preparedImages = imagePaths.length ? await prepareChatGPTImagePaths(imagePaths) : { ok: true, paths: [] };
        if (!preparedImages.ok) {
            throw new ArgumentError(preparedImages.reason);
        }

        // Navigate to /c/<id> when continuing, otherwise /new (full reload to
        // clear React sidebar state).
        const targetUrl = conversationId
            ? `https://${CHATGPT_DOMAIN}/c/${conversationId}`
            : `https://${CHATGPT_DOMAIN}/new`;
        await page.goto(targetUrl, { settleMs: 2000 });
        await clearChatGPTDraft(page);

        if (imagePaths.length) {
            let upload;
            try {
                upload = await uploadChatGPTImages(page, preparedImages.paths);
            } catch (err) {
                throw new CommandExecutionError(`Failed to upload image to ChatGPT: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (!upload?.ok) throw new CommandExecutionError(upload?.reason || 'Failed to upload image to ChatGPT');
        }

        // Toggle on the Image tool so the aspect picker surfaces and the
        // prompt routes deterministically through the image generator
        // regardless of model auto-routing heuristics.
        const activated = await activateChatGPTImageTool(page);
        if (!activated) {
            throw new CommandExecutionError(
                'Failed to activate the ChatGPT Image tool',
                `Open ${await currentChatGPTLink(page)} and verify the "+" menu shows a "Create image" entry.`,
            );
        }
        if (aspectAriaLabel && aspectAriaLabel !== 'Auto') {
            const picked = await setChatGPTImageAspect(page, aspectAriaLabel);
            if (!picked) {
                throw new CommandExecutionError(
                    `Failed to set image aspect to "${aspectAriaLabel}"`,
                    `Open ${await currentChatGPTLink(page)} and pick the aspect manually to verify availability.`,
                );
            }
        }

        const beforeUrls = await getChatGPTVisibleImageUrls(page);

        // When continuing a conversation the user prompt already has context,
        // so send it verbatim. Fresh chats keep the legacy "Generate an image
        // of:" / "Edit the attached image:" wrappers for backward compatibility.
        const promptToSend = conversationId ? prompt : buildPrompt(prompt, imagePaths.length);
        const sent = await sendChatGPTMessage(page, promptToSend);
        if (!sent) {
            throw new CommandExecutionError(
                'Failed to send image prompt to ChatGPT',
                `Open ${await currentChatGPTLink(page)} and verify the composer is ready.`,
            );
        }

        // ChatGPT briefly navigates to /c/{id} after sending, then may
        // redirect back to the home page. Poll until we capture the /c/ URL.
        let convUrl = '';
        for (let ci = 0; ci < 10; ci++) {
            const url = await currentChatGPTLink(page);
            if (url.includes('/c/')) { convUrl = url; break; }
            await page.wait(2);
        }
        if (!convUrl) {
            convUrl = await currentChatGPTLink(page);
        }

        const urls = await waitForChatGPTImages(page, beforeUrls, timeout, convUrl);
        const link = convUrl;

        if (!urls.length) {
            throw new EmptyResultError('chatgpt image', `No generated images were detected before timeout. Open ${link} and verify whether ChatGPT finished generating the image.`);
        }

        if (skipDownload) {
            return [{ status: '🎨 generated', file: '📁 -', link: `🔗 ${link}` }];
        }

        // Export and save images
        const assets = await getChatGPTImageAssets(page, urls);
        if (!assets.length) {
            throw new CommandExecutionError('Failed to export generated ChatGPT image assets', `Open ${link} and verify the generated images are visible, then retry.`);
        }

        const stamp = Date.now();
        const results = [];
        for (let index = 0; index < assets.length; index += 1) {
            const asset = assets[index];
            const base64 = asset.dataUrl.replace(/^data:[^;]+;base64,/, '');
            const suffix = assets.length > 1 ? `_${index + 1}` : '';
            const ext = extFromMime(asset.mimeType);
            const filePath = nextAvailablePath(outputDir, `chatgpt_${stamp}${suffix}`, ext);
            await saveBase64ToFile(base64, filePath);
            results.push({ status: '✅ saved', file: `📁 ${displayPath(filePath)}`, link: `🔗 ${link}` });
        }
        return results;
    },
});
