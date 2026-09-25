import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatCookieHeader } from '@jackwener/opencli/download';
import { downloadMedia } from '@jackwener/opencli/download/media-download';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { DOUBAO_DOMAIN, getConversationAssets, parseDoubaoConversationId } from './utils.js';

const SUPPORTED_VARIANTS = new Set(['original', 'raw', 'preview', 'thumb']);

function parseIntegerOption(rawValue, fallback, label, allowZero = false) {
    const value = rawValue ?? String(fallback);
    const parsed = Number(value);
    const minimum = allowZero ? 0 : 1;
    if (!Number.isInteger(parsed) || parsed < minimum) {
        throw new ArgumentError(`Invalid Doubao ${label}: ${value}`, allowZero
            ? 'Use 0 or a positive integer.'
            : 'Use a positive integer.');
    }
    return parsed;
}

function sanitizeFilenamePart(value) {
    return String(value || '')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120);
}

function extensionFromAsset(asset) {
    const format = String(asset.format || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (format) {
        if (format === 'jpeg')
            return '.jpg';
        if (format === 'heic')
            return '.heic';
        return `.${format}`;
    }
    try {
        const ext = path.extname(new URL(asset.url).pathname).toLowerCase();
        if (ext)
            return ext;
    }
    catch { }
    return asset.type === 'video' ? '.mp4' : '.jpg';
}

function filenameForAsset(conversationId, asset, index) {
    const rawStem = String(asset.resourceId || asset.identifier || asset.key || `${conversationId}_${index}`);
    const basename = rawStem.split('/').filter(Boolean).pop() || rawStem;
    const stem = sanitizeFilenamePart(basename.replace(/\.[a-z0-9]{2,5}$/i, ''));
    const ext = extensionFromAsset(asset);
    return `${String(index).padStart(3, '0')}_${stem || conversationId}${ext}`;
}

export const downloadCommand = cli({
    site: 'doubao',
    name: 'download',
    access: 'read',
    description: 'Download images and media from a Doubao conversation',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'Conversation ID (numeric or full URL)' },
        { name: 'output', required: false, default: './doubao-downloads', help: 'Output directory' },
        { name: 'variant', required: false, default: 'original', help: 'Image variant: original, raw, preview, or thumb' },
        { name: 'limit', required: false, default: '0', help: 'Max media files to download; 0 means all' },
        { name: 'timeout', required: false, default: '15000', help: 'Per-file download timeout in milliseconds' },
    ],
    columns: ['index', 'type', 'status', 'size', 'filename', 'url'],
    func: async (page, kwargs) => {
        const conversationId = parseDoubaoConversationId(String(kwargs.id || ''));
        const output = String(kwargs.output || './doubao-downloads');
        const variant = String(kwargs.variant || 'original');
        if (!SUPPORTED_VARIANTS.has(variant)) {
            throw new ArgumentError(`Invalid Doubao image variant: ${variant}`, 'Use original, raw, preview, or thumb.');
        }
        const limit = parseIntegerOption(kwargs.limit, 0, 'media limit', true);
        const timeout = parseIntegerOption(kwargs.timeout, 15000, 'download timeout');
        const assets = await getConversationAssets(page, conversationId, { variant });
        const selectedAssets = limit > 0 ? assets.slice(0, limit) : assets;
        if (selectedAssets.length === 0) {
            throw new EmptyResultError('doubao download', `No media was extracted for conversation ${conversationId}.`);
        }
        const cookies = formatCookieHeader(await page.getCookies({ domain: 'doubao.com' }));
        const mediaItems = selectedAssets.map((asset, index) => ({
            type: asset.type === 'video' ? 'video' : 'image',
            url: asset.url,
            filename: filenameForAsset(conversationId, asset, index + 1),
        }));
        return downloadMedia(mediaItems, {
            output,
            subdir: conversationId,
            cookies,
            filenamePrefix: conversationId,
            timeout,
        });
    },
});
