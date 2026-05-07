import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getChatGPTVisibleImageUrls, sendChatGPTMessage, waitForChatGPTImages, getChatGPTImageAssets } from './utils.js';

const CHATGPT_DOMAIN = 'chatgpt.com';

function extFromMime(mime) {
    if (mime.includes('png')) return '.png';
    if (mime.includes('webp')) return '.webp';
    if (mime.includes('gif')) return '.gif';
    return '.jpg';
}

function normalizeBooleanFlag(value) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
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
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Image prompt to send to ChatGPT' },
        { name: 'op', help: 'Output directory (default: ~/Pictures/chatgpt)' },
        { name: 'sd', type: 'boolean', default: false, help: 'Skip download shorthand; only show ChatGPT link' },
        { name: 'timeout', type: 'int', required: false, default: 240, help: 'Max seconds for the overall command (default: 240)' },
    ],
    columns: ['status', 'file', 'link'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const outputDir = resolveOutputDir(kwargs.op);
        const skipDownloadRaw = kwargs.sd;
        const skipDownload = skipDownloadRaw === '' || skipDownloadRaw === true || normalizeBooleanFlag(skipDownloadRaw);
        const timeout = kwargs.timeout;
        if (!Number.isInteger(timeout) || timeout < 1) {
            throw new ArgumentError('--timeout must be a positive integer (seconds)');
        }

        // Navigate to chatgpt.com/new with full reload to clear React sidebar state
        await page.goto(`https://${CHATGPT_DOMAIN}/new`, { settleMs: 2000 });

        const beforeUrls = await getChatGPTVisibleImageUrls(page);

        // Send the image generation prompt - must be explicit
        const sent = await sendChatGPTMessage(page, `Generate an image of: ${prompt}`);
        if (!sent) {
            return [{ status: '⚠️ send-failed', file: '📁 -', link: `🔗 ${await currentChatGPTLink(page)}` }];
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
