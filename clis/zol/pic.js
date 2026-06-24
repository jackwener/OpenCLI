/**
 * zol pic — product image gallery (图片) for a product.
 *
 * Hits `detail.zol.com.cn/0/<productId>/pic.shtml` (the `/0/` segment
 * 301-redirects to the canonical numeric subcategory, which `fetch` follows)
 * and reads the gallery. Each thumbnail is an `imgwrap` anchor wrapping an
 * `<img src="…zol-img.com.cn/product/…">` whose `alt` names the shot type
 * (外观图 / 细节图 / 官方图 …).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    ZOL_DETAIL,
    PIC_COLUMNS,
    clean,
    normalizeProductId,
    requireLimit,
    zolFetch,
} from './utils.js';

/**
 * Pure parser: gallery HTML → image rows. Exported for unit testing.
 *
 * Anchors on the `imgwrap` thumbnail wrapper (so related-product thumbnails
 * elsewhere on the page are excluded), then reads the lazy-load `src`
 * (`data-src`/`data-original` when present) and the `alt` shot-type label.
 * Rows are deduped by image URL.
 */
export function parsePicRows(html, limit) {
    const text = String(html || '');
    const WRAP_RE = /class="imgwrap"[^>]*>\s*<img\b([^>]*)>/g;
    const rows = [];
    const seen = new Set();
    let m;
    while ((m = WRAP_RE.exec(text)) !== null) {
        const attrs = m[1];
        const src = attrs.match(/\b(?:data-src|data-original|src)="([^"]+\.(?:jpg|png|webp))"/)?.[1];
        if (!src) continue;
        const url = src.startsWith('//') ? `https:${src}` : src;
        if (!/zol-img\.com\.cn\/product\//.test(url) || seen.has(url)) continue;
        seen.add(url);
        rows.push({
            rank: rows.length + 1,
            type: clean(attrs.match(/\balt="([^"]*)"/)?.[1]) || '图片',
            url,
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'zol',
    name: 'pic',
    access: 'read',
    aliases: ['pics', 'images'],
    description: '中关村在线产品图片（按产品 id 返回外观图/细节图等图集 URL）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'product', required: true, positional: true, help: '产品 id（来自 search 的 product_id 列）或 detail.zol.com.cn 详情页 URL' },
        { name: 'limit', type: 'int', default: 20, help: '返回的图片数量（最多 60）' },
    ],
    columns: PIC_COLUMNS,
    func: async (args) => {
        const productId = normalizeProductId(args.product);
        const limit = requireLimit(args.limit, 20, 60);
        const html = await zolFetch(
            `${ZOL_DETAIL}/0/${productId}/pic.shtml`,
            `pic ${productId}`,
        );
        const rows = parsePicRows(html, limit);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `zol pic ${productId}`,
                'No gallery images found — the product id may not exist or have no photos.',
            );
        }
        return rows;
    },
});
