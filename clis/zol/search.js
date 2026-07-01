/**
 * zol search — find digital products (手机/笔记本/相机…) by keyword.
 *
 * Hits the SSR search page `https://search.zol.com.cn/s/all.php?kword=...`
 * and reads the product result list. Each product `<li>` carries a 报价
 * (price), the product name and a `detail.zol.com.cn/.../index<id>.shtml`
 * link whose numeric id feeds `param` / `price`.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    ZOL_SEARCH,
    SEARCH_COLUMNS,
    clean,
    requireLimit,
    zolFetch,
} from './utils.js';

/**
 * Pure parser: search HTML → product rows. Exported for unit testing against
 * the frozen fixture so structure drift is caught without a live fetch.
 *
 * A product result is a `<li>` holding an optional `<span class="price">`
 * followed by an `<a href="//detail.zol.com.cn/<cat>/index<id>.shtml">name</a>`.
 * Rows are deduped by product id (the title and the in-card variant list can
 * repeat the same anchor).
 */
export function parseSearchRows(html, limit) {
    const text = String(html || '');
    const ITEM_RE =
        /<li>\s*(?:<span class="price">([^<]*)<\/span>\s*)?<a href="(\/\/detail\.zol\.com\.cn\/[^"]*?index(\d+)\.shtml)"[^>]*>([^<]+)<\/a>/g;
    const rows = [];
    const seen = new Set();
    let m;
    while ((m = ITEM_RE.exec(text)) !== null) {
        const [, priceRaw, hrefRaw, productId, nameRaw] = m;
        if (seen.has(productId)) continue;
        const name = clean(nameRaw);
        if (!name) continue;
        seen.add(productId);
        rows.push({
            rank: rows.length + 1,
            product_id: productId,
            name,
            price: clean(priceRaw) || null,
            url: `https:${hrefRaw}`,
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'zol',
    name: 'search',
    access: 'read',
    description: '中关村在线产品搜索（按关键词搜手机/笔记本/相机等，返回名称 + 报价 + 产品 id）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'keyword', required: true, positional: true, help: '搜索关键词，例如 "iPhone 15" 或 "ThinkPad X1"' },
        { name: 'limit', type: 'int', default: 20, help: '返回的产品数量（最多 40）' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (args) => {
        const keyword = String(args.keyword || '').trim();
        if (!keyword) throw new ArgumentError('keyword', 'must be a non-empty string');
        const limit = requireLimit(args.limit, 20, 40);

        const html = await zolFetch(
            `${ZOL_SEARCH}/s/all.php?kword=${encodeURIComponent(keyword)}`,
            `search "${keyword}"`,
        );
        const rows = parseSearchRows(html, limit);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `zol search "${keyword}"`,
                'No products matched. Try a model name, e.g. "iPhone 15" or "RTX 4090".',
            );
        }
        return rows;
    },
});
