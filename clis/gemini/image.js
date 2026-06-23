import * as os from 'node:os';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
import { ArgumentError } from '@jackwener/opencli/errors';
import { GEMINI_APP_URL, GEMINI_DOMAIN, exportGeminiImages, getGeminiVisibleImageUrls, sendGeminiMessage, startNewGeminiChat, waitForGeminiConversationId, waitForGeminiImages } from './utils.js';
function extFromMime(mime) {
    if (mime.includes('png'))
        return '.png';
    if (mime.includes('webp'))
        return '.webp';
    if (mime.includes('gif'))
        return '.gif';
    return '.jpg';
}
function normalizeBooleanFlag(value) {
    if (typeof value === 'boolean')
        return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
function expandHome(value) {
    const raw = String(value ?? '');
    if (raw === '~')
        return os.homedir();
    if (raw.startsWith('~/'))
        return path.join(os.homedir(), raw.slice(2));
    return raw;
}
function displayPath(filePath) {
    const home = os.homedir();
    return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}
function buildImagePrompt(prompt, options) {
    const extras = [];
    if (options.ratio)
        extras.push(`aspect ratio ${options.ratio}`);
    if (options.style)
        extras.push(`style ${options.style}`);
    if (extras.length === 0)
        return prompt;
    return `${prompt}

Image requirements: ${extras.join(', ')}.`;
}
function normalizeRatio(value) {
    const normalized = value.trim();
    const allowed = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);
    return allowed.has(normalized) ? normalized : '1:1';
}
async function currentGeminiLink(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    return typeof url === 'string' && url ? url : 'https://gemini.google.com/app';
}
export const imageCommand = cli({
    site: 'gemini',
    name: 'image',
    access: 'write',
    description: 'Generate images with Gemini web and save them locally',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    // Ephemeral so concurrent `gemini image` processes each get an isolated
    // tab/chat instead of fighting over one shared `site:gemini` tab. Combined
    // with the chat-id anchoring below, every run grabs the image from its own
    // conversation. Note: Gemini's backend serializes image generation per
    // account, so truly simultaneous launches still collide (one stalls) —
    // stagger concurrent runs by ~20-30s to let each generation land cleanly.
    siteSession: 'ephemeral',
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Image prompt to send to Gemini' },
        { name: 'rt', default: '1:1', help: 'Ratio shorthand for aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3)' },
        { name: 'st', default: '', help: 'Style shorthand, e.g. anime, icon, watercolor' },
        { name: 'op', default: '~/tmp/gemini-images', help: 'Output directory shorthand' },
        { name: 'sd', type: 'boolean', default: false, help: 'Skip download shorthand; only show Gemini page link' },
        { name: 'timeout', type: 'int', required: false, default: 240, help: 'Max seconds for the overall command (default: 240)' },
    ],
    columns: ['status', 'file', 'link'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const ratio = normalizeRatio(String(kwargs.rt ?? '1:1'));
        const style = String(kwargs.st ?? '').trim();
        const outputDir = expandHome(kwargs.op || path.join(os.homedir(), 'tmp', 'gemini-images'));
        const timeout = kwargs.timeout;
        if (!Number.isInteger(timeout) || timeout < 1) {
            throw new ArgumentError('--timeout must be a positive integer (seconds)');
        }
        const skipDownloadRaw = kwargs.sd;
        const skipDownload = skipDownloadRaw === '' || skipDownloadRaw === true || normalizeBooleanFlag(skipDownloadRaw);
        const effectivePrompt = buildImagePrompt(prompt, {
            ratio,
            style: style || undefined,
        });
        await startNewGeminiChat(page);
        const beforeUrls = await getGeminiVisibleImageUrls(page);
        await sendGeminiMessage(page, effectivePrompt);
        // Anchor every subsequent image scan to the chat this generation created
        // so a concurrent `gemini image` run can't swap the visible chat out from
        // under us and make us grab its image.
        const conversationId = await waitForGeminiConversationId(page, Math.min(30, timeout));
        const urls = await waitForGeminiImages(page, beforeUrls, timeout, conversationId);
        const link = conversationId ? `${GEMINI_APP_URL}/${conversationId}` : await currentGeminiLink(page);
        if (!urls.length) {
            return [{ status: '⚠️ no-images', file: '📁 -', link: `🔗 ${link}` }];
        }
        if (skipDownload) {
            return [{ status: '🎨 generated', file: '📁 -', link: `🔗 ${link}` }];
        }
        const assets = await exportGeminiImages(page, urls, conversationId);
        if (!assets.length) {
            return [{ status: '⚠️ export-failed', file: '📁 -', link: `🔗 ${link}` }];
        }
        const stamp = Date.now();
        const results = [];
        for (let index = 0; index < assets.length; index += 1) {
            const asset = assets[index];
            const base64 = asset.dataUrl.replace(/^data:[^;]+;base64,/, '');
            const suffix = assets.length > 1 ? `_${index + 1}` : '';
            const filePath = path.join(outputDir, `gemini_${stamp}${suffix}${extFromMime(asset.mimeType)}`);
            await saveBase64ToFile(base64, filePath);
            results.push({ status: '✅ saved', file: `📁 ${displayPath(filePath)}`, link: `🔗 ${link}` });
        }
        return results;
    },
});
export const __test__ = { expandHome };
