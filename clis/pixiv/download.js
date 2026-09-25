/**
 * Pixiv download — download all images from an illustration.
 *
 * Pixiv's CDN (i.pximg.net) requires Referer: https://www.pixiv.net/ header.
 * Uses the /ajax/illust/{id}/pages API to get original-quality image URLs.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatCookieHeader, httpDownload } from '@jackwener/opencli/download';
import { formatBytes } from '@jackwener/opencli/download/progress';
import { ArgumentError, CommandExecutionError, EmptyResultError, getErrorMessage } from '@jackwener/opencli/errors';
import { pixivFetch } from './utils.js';

function normalizeIllustId(value) {
    const input = String(value ?? '').trim();
    if (/^\d+$/.test(input)) return input;
    try {
        const url = new URL(input);
        if (url.protocol === 'https:' && (url.hostname === 'www.pixiv.net' || url.hostname === 'pixiv.net') && !url.username && !url.password && !url.port) {
            const match = url.pathname.match(/^\/artworks\/(\d+)\/?$/);
            if (match) return match[1];
        }
    }
    catch {}
    throw new ArgumentError(`Invalid illustration ID or Pixiv artwork URL: ${input}`, 'Example: opencli pixiv download 123456 or https://www.pixiv.net/artworks/123456');
}

cli({
    site: 'pixiv',
    name: 'download',
    access: 'read',
    description: 'Download illustration images from Pixiv',
    domain: 'www.pixiv.net',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'illust-id', positional: true, required: true, help: 'Illustration ID or Pixiv artwork URL' },
        { name: 'output', default: './pixiv-downloads', help: 'Output directory' },
    ],
    columns: ['index', 'type', 'status', 'size'],
    func: async (page, kwargs) => {
        const illustId = normalizeIllustId(kwargs['illust-id']);
        const output = String(kwargs.output ?? './pixiv-downloads');
        // pixivFetch handles navigate + error checking; returns the response body directly
        const pages = await pixivFetch(page, `/ajax/illust/${illustId}/pages`, {
            notFoundMsg: `Illustration not found: ${illustId}`,
        });
        if (!Array.isArray(pages)) {
            throw new CommandExecutionError('Pixiv pages API returned malformed payload');
        }
        if (pages.length === 0) {
            throw new EmptyResultError('pixiv download', `No images found for illustration ${illustId}.`);
        }
        // Extract cookies for authenticated downloads
        const cookies = formatCookieHeader(await page.getCookies({ domain: 'pixiv.net' }));
        // Create output directory
        const outputDir = path.join(output, illustId);
        fs.mkdirSync(outputDir, { recursive: true });
        const results = [];
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            const url = p.urls?.original || p.urls?.regular || '';
            if (!url) {
                results.push({ index: i + 1, type: 'image', status: 'failed', size: 'No URL' });
                continue;
            }
            try {
                const ext = path.extname(new URL(url).pathname) || '.jpg';
                const filename = `${illustId}_p${i}${ext}`;
                const destPath = path.join(outputDir, filename);
                const result = await httpDownload(url, destPath, {
                    cookies,
                    headers: { Referer: 'https://www.pixiv.net/' },
                    timeout: 60000,
                });
                results.push({
                    index: i + 1,
                    type: 'image',
                    status: result.success ? 'success' : 'failed',
                    size: result.success ? formatBytes(result.size) : (result.error || 'unknown error'),
                });
            }
            catch (err) {
                results.push({
                    index: i + 1,
                    type: 'image',
                    status: 'failed',
                    size: getErrorMessage(err),
                });
            }
        }
        return results;
    },
});
