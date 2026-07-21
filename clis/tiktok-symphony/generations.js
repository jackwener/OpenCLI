// tiktok-symphony generations — assets in the Symphony Creative Studio Library.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    DEEP_QUERY_SRC,
    HOST,
    LIBRARY_SCROLL_SRC,
    LIBRARY_URL,
    normalizeLimit,
    readStable,
    waitForValue,
} from './utils.js';

/**
 * Collect every rendered Library tile. Runs in page context.
 *
 * Images and clips are two different worlds here:
 *   image → <img> on ad-site-sign-sg/ad-creative-sg, identity = path segment
 *   clip  → <video> on v16-ad-creative.tiktokcdn-row.com, identity = `vid` param
 * Neither carries a generation id, and the URLs are signed and short-lived, so
 * these handles are all `download` has to work with.
 *
 * The type comes from the element kind rather than the tile's badge text: the
 * badge is localized, and clip tiles are labelled with the tool name
 * ("Reference to video") instead of a "Video" badge at all.
 */
const SCRAPE_SRC = `(() => {
    ${DEEP_QUERY_SRC}
    const seen = new Set();
    const rows = [];

    for (const img of __deepAll(document, (el) => el.tagName === 'IMG')) {
        const m = /ad-site-sign-sg\\.tiktokcdn\\.com\\/ad-creative-sg\\/([A-Za-z0-9]+)~/.exec(img.src || '');
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        rows.push({ assetId: m[1], type: 'Image', url: img.src });
    }

    for (const v of __deepAll(document, (el) => el.tagName === 'VIDEO')) {
        const src = v.src || v.currentSrc || '';
        if (!src || /lf-creative-factory/.test(src)) continue; // static demo clip
        const vid = /[?&]vid=([A-Za-z0-9]+)/.exec(src);
        const tos = /\\/video\\/tos\\/[^/]+\\/[^/]+\\/([A-Za-z0-9]+)\\//.exec(src);
        const assetId = (vid && vid[1]) || (tos && tos[1]);
        if (!assetId || seen.has(assetId)) continue;
        seen.add(assetId);
        rows.push({ assetId, type: 'Video', url: src });
    }

    return rows.length ? rows : null;
})()`;

cli({
    site: 'tiktok-symphony',
    name: 'generations',
    aliases: ['library'],
    description: 'List generated assets in the Symphony Creative Studio Library',
    access: 'read',
    example: 'opencli tiktok-symphony generations --limit 10',
    domain: HOST,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: LIBRARY_URL,
    // The Library/feed tiles mount lazily via IntersectionObserver. A
    // background tab is never rendered, so nothing ever intersects and the
    // grid stays empty — this command is only correct in the foreground.
    defaultWindowMode: 'foreground',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of assets to return (max 200)' },
    ],
    columns: ['index', 'assetId', 'type', 'url'],
    func: async (page, args) => {
        const limit = normalizeLimit(args.limit, 20, 200, 'limit');

        await waitForValue(page, SCRAPE_SRC, { label: 'Symphony Library grid', timeoutMs: 30000 });

        // Tiles are accumulated across reads rather than replaced: the grid
        // mounts them lazily on scroll, and nothing guarantees an earlier tile
        // is still mounted by the time we reach the bottom.
        const found = new Map();
        const collect = async (src, opts) => {
            const batch = opts ? await readStable(page, src, opts) : await page.evaluate(src);
            if (!Array.isArray(batch)) {
                if (batch !== null) throw new CommandExecutionError('Library scrape returned an unexpected shape');
                return;
            }
            for (const row of batch) if (!found.has(row.assetId)) found.set(row.assetId, row);
        };

        await collect(SCRAPE_SRC, { tries: 8, intervalMs: 1200 });

        // Thumbnails have been observed taking the better part of a minute to
        // decode, so reaching the bottom of the grid is not a reason to stop —
        // only a stretch with nothing new arriving is. Bounded by a deadline so
        // a genuinely empty tail cannot spin.
        const deadline = Date.now() + 60000;
        let stalls = 0;
        while (found.size < limit && Date.now() < deadline && stalls < 6) {
            const before = found.size;
            await page.evaluate(LIBRARY_SCROLL_SRC);
            await new Promise((resolve) => setTimeout(resolve, 1500));
            await collect(SCRAPE_SRC);
            stalls = found.size > before ? 0 : stalls + 1;
        }

        await collect(SCRAPE_SRC, { tries: 6, intervalMs: 1200 });

        const rows = [...found.values()];
        if (rows.length === 0) {
            throw new EmptyResultError('tiktok-symphony generations', 'The Library has no generated assets yet');
        }

        return rows.slice(0, limit).map((row, i) => ({
            index: i + 1,
            assetId: row.assetId,
            type: row.type,
            url: row.url,
        }));
    },
});
