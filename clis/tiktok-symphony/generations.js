// tiktok-symphony generations — assets in the Symphony Creative Studio Library.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { DEEP_QUERY_SRC, HOST, LIBRARY_URL, normalizeLimit, waitForValue } from './utils.js';

/**
 * Collect every rendered Library tile. Runs in page context.
 *
 * The Library grid has no generation id anywhere in the DOM — the only
 * per-asset identity is the path segment of the signed CDN URL, so that is
 * what we surface and what `download` consumes.
 */
const SCRAPE_SRC = `(() => {
    ${DEEP_QUERY_SRC}
    const imgs = __deepAll(document, (el) => el.tagName === 'IMG'
        && /ad-site-sign-sg\\.tiktokcdn\\.com\\/ad-creative-sg\\//.test(el.src || ''));
    if (!imgs.length) return null;

    const seen = new Set();
    const rows = [];
    for (const img of imgs) {
        const m = /\\/ad-creative-sg\\/([A-Za-z0-9]+)~/.exec(img.src);
        if (!m) continue;
        const assetId = m[1];
        if (seen.has(assetId)) continue;
        seen.add(assetId);

        // The tile badge reads "Image" or "Video"; walk up until we meet it.
        let kind = null;
        let node = img;
        for (let i = 0; i < 6 && node; i++) {
            const t = (node.textContent || '').trim();
            // Tile text reads e.g. "ImageDownload" — no word boundary after the badge.
            const hit = /^(Image|Video)/.exec(t);
            if (hit) { kind = hit[1]; break; }
            node = node.parentElement;
        }

        rows.push({ assetId, type: kind, url: img.src });
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
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of assets to return (max 200)' },
    ],
    columns: ['index', 'assetId', 'type', 'url'],
    func: async (page, args) => {
        const limit = normalizeLimit(args.limit, 20, 200, 'limit');

        let rows = await waitForValue(page, SCRAPE_SRC, { label: 'Symphony Library grid', timeoutMs: 30000 });

        // The grid pages in on scroll. Keep scrolling while it still grows and
        // we are short of `limit`, with a hard stop so a stuck grid cannot spin.
        for (let attempt = 0; rows.length < limit && attempt < 12; attempt++) {
            const before = rows.length;
            await page.scroll('down', 3);
            await new Promise((resolve) => setTimeout(resolve, 1200));
            const next = await page.evaluate(SCRAPE_SRC);
            if (!Array.isArray(next) || next.length <= before) break;
            rows = next;
        }

        if (!Array.isArray(rows)) {
            throw new CommandExecutionError('Library scrape returned an unexpected shape');
        }
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
