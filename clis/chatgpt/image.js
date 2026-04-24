import * as os from 'node:os';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
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

async function currentChatGPTLink(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    return typeof url === 'string' && url ? url : 'https://chatgpt.com';
}

export const imageCommand = cli({
    site: 'chatgpt',
    name: 'image',
    description: 'Generate images with ChatGPT web and save them locally',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultFormat: 'plain',
    timeoutSeconds: 240,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Image prompt to send to ChatGPT' },
        { name: 'op', default: '~/Pictures/chatgpt', help: 'Output directory' },
        { name: 'sd', type: 'boolean', default: false, help: 'Skip download shorthand; only show ChatGPT link' },
    ],
    columns: ['status', 'file', 'link'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const outputDir = kwargs.op || path.join(os.homedir(), 'Pictures', 'chatgpt');
        const skipDownloadRaw = kwargs.sd;
        const skipDownload = skipDownloadRaw === '' || skipDownloadRaw === true || normalizeBooleanFlag(skipDownloadRaw);
        const timeout = 120;

        // Navigate to chatgpt.com/new with full reload to clear React sidebar state
        await page.goto(`https://${CHATGPT_DOMAIN}/new`, { settleMs: 2000 });

        const beforeUrls = await getChatGPTVisibleImageUrls(page);

        // Send the image generation prompt - must be explicit
        const sent = await sendChatGPTMessage(page, `Generate an image of: ${prompt}`);
        if (!sent) {
            return [{ status: '⚠️ send-failed', file: '📁 -', link: `🔗 ${await currentChatGPTLink(page)}` }];
        }

        // Wait for response and images
        const urls = await waitForChatGPTImages(page, beforeUrls, timeout);
        const link = await currentChatGPTLink(page);

        if (!urls.length) {
            return [{ status: '⚠️ no-images', file: '📁 -', link: `🔗 ${link}` }];
        }

        if (skipDownload) {
            return [{ status: '🎨 generated', file: '📁 -', link: `🔗 ${link}` }];
        }

        // Export and save images
        const assets = await getChatGPTImageAssets(page, urls);
        if (!assets.length) {
            return [{ status: '⚠️ export-failed', file: '📁 -', link: `🔗 ${link}` }];
        }

        const stamp = Date.now();
        const results = [];
        for (let index = 0; index < assets.length; index += 1) {
            const asset = assets[index];
            const base64 = asset.dataUrl.replace(/^data:[^;]+;base64,/, '');
            const suffix = assets.length > 1 ? `_${index + 1}` : '';
            const ext = extFromMime(asset.mimeType);
            const filePath = path.join(outputDir, `chatgpt_${stamp}${suffix}${ext}`);
            await saveBase64ToFile(base64, filePath);
            results.push({ status: '✅ saved', file: `📁 ${displayPath(filePath)}`, link: `🔗 ${link}` });
        }
        return results;
    },
});
