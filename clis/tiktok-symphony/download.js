// tiktok-symphony download — save a generated asset to a local file.
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { DEEP_QUERY_SRC, HOST, LIBRARY_SCROLL_SRC, LIBRARY_URL, waitForValue } from './utils.js';

const EXT_BY_TYPE = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
};

/**
 * Page-context lookup: the signed CDN URL for one assetId, if it is rendered.
 *
 * Images and clips live on different hosts with different identity schemes, so
 * both are searched: an image assetId is a path segment, a clip assetId is the
 * `vid` query parameter (see `generations`).
 */
function findUrlSrc(assetId) {
    return `(() => {
        ${DEEP_QUERY_SRC}
        const want = ${JSON.stringify(assetId)};
        const img = __deepAll(document, (el) => el.tagName === 'IMG'
            && (el.src || '').includes('/ad-creative-sg/' + want + '~'))[0];
        if (img) return img.src;
        const video = __deepAll(document, (el) => el.tagName === 'VIDEO'
            && (el.src || el.currentSrc || '').includes(want))[0];
        return video ? (video.src || video.currentSrc) : null;
    })()`;
}

cli({
    site: 'tiktok-symphony',
    name: 'download',
    description: 'Download a generated Symphony asset by assetId (see: generations)',
    access: 'read',
    example: 'opencli tiktok-symphony download 202607195d0d7ea36ed139b74eccb1e4 --out ./downloads',
    domain: HOST,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: LIBRARY_URL,
    // The Library/feed tiles mount lazily via IntersectionObserver. A
    // background tab is never rendered, so nothing ever intersects and the
    // grid stays empty — this command is only correct in the foreground.
    defaultWindowMode: 'foreground',
    args: [
        { name: 'asset', type: 'string', required: true, positional: true, help: 'assetId from `generations`, or a full asset URL' },
        { name: 'out', type: 'string', default: '.', help: 'Directory to write the file into' },
    ],
    columns: ['assetId', 'file', 'bytes', 'contentType'],
    func: async (page, args) => {
        const asset = String(args.asset ?? '').trim();
        if (!asset) throw new ArgumentError('asset is required: pass an assetId or a full asset URL');

        const outDir = String(args.out ?? '.');

        let assetId;
        let url;
        if (/^https?:\/\//i.test(asset)) {
            url = asset;
            const image = /\/ad-creative-sg\/([A-Za-z0-9]+)~/.exec(asset);
            const clip = /[?&]vid=([A-Za-z0-9]+)/.exec(asset);
            assetId = image?.[1] || clip?.[1] || basename(new URL(asset).pathname);
        } else {
            if (!/^[A-Za-z0-9]+$/.test(asset)) {
                throw new ArgumentError(`"${asset}" is not a valid assetId (expected alphanumeric) or URL`);
            }
            assetId = asset;

            // Asset URLs are signed and short-lived, so they have to be read
            // from the live Library rather than reconstructed.
            url = await page.evaluate(findUrlSrc(assetId));
            for (let attempt = 0; !url && attempt < 30; attempt++) {
                const scrolled = await page.evaluate(LIBRARY_SCROLL_SRC);
                await new Promise((r) => setTimeout(r, 1200));
                url = await page.evaluate(findUrlSrc(assetId));
                if (!url && scrolled?.atEnd) break;
            }
            if (!url) {
                // Give the grid one slow chance in case it was still hydrating.
                try {
                    url = await waitForValue(page, findUrlSrc(assetId), {
                        label: `asset ${assetId} in Library`,
                        timeoutMs: 8000,
                    });
                } catch {
                    throw new EmptyResultError(
                        'tiktok-symphony download',
                        `assetId ${assetId} was not found in the Library — check \`opencli tiktok-symphony generations\``,
                    );
                }
            }
        }

        let resp;
        try {
            resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://${HOST}/` } });
        } catch (error) {
            throw new CommandExecutionError(`asset download failed: ${error?.message || error}`);
        }
        if (!resp.ok) throw new CommandExecutionError(`asset download failed: HTTP ${resp.status}`);

        const contentType = (resp.headers.get('content-type') || '').split(';')[0].trim() || null;
        const bytes = Buffer.from(await resp.arrayBuffer());
        if (bytes.length === 0) throw new CommandExecutionError(`asset ${assetId} returned an empty body`);

        const ext = EXT_BY_TYPE[contentType] || 'bin';
        const dir = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);
        try {
            await mkdir(dir, { recursive: true });
        } catch (error) {
            throw new CommandExecutionError(`could not create output directory "${dir}": ${error?.message || error}`);
        }

        const file = join(dir, `${assetId}.${ext}`);
        try {
            await writeFile(file, bytes);
        } catch (error) {
            throw new CommandExecutionError(`could not write "${file}": ${error?.message || error}`);
        }

        return [{ assetId, file, bytes: bytes.length, contentType }];
    },
});
