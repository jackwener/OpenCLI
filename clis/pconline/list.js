/**
 * pconline list — browse a 产品库 category (产品大全).
 *
 * Hits the SSR category page `product.pconline.com.cn/<category>/` and reads
 * the product grid (`#JlistItems > li.item`). It's the discovery entry point
 * (PConline's keyword search sits behind a JS/anti-bot challenge): each row
 * carries the product name, its reference price and the full detail URL whose
 * `<category>/<brand>/<id>` triple feeds `info` / `param`.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    PC_PRODUCT,
    LIST_COLUMNS,
    CATEGORIES,
    clean,
    requireLimit,
    pcFetch,
} from './utils.js';

/**
 * Pure parser: category HTML → product rows. Exported for unit testing.
 *
 * Scopes to the `#JlistItems` grid (so the page's filter `li.item`s are
 * excluded), then per card pulls the detail link (→ category/brand/id), the
 * `item-title-name`, and the price (`price-none` / 暂无 → null). Rows are
 * deduped by product id.
 */
export function parseListRows(html, limit) {
    const text = String(html || '');
    const start = text.indexOf('JlistItems');
    if (start < 0) return [];
    const grid = text.slice(start);

    const CARD_RE = /<li class="item">([\s\S]*?)<\/li>/g;
    const rows = [];
    const seen = new Set();
    let m;
    while ((m = CARD_RE.exec(grid)) !== null) {
        const card = m[1];
        const link = card.match(/href="(\/\/product\.pconline\.com\.cn\/([a-z]+)\/([a-z0-9]+)\/(\d+)\.html)"/i);
        if (!link) continue;
        const [, href, category, brand, productId] = link;
        if (seen.has(productId)) continue;

        const name = clean(
            card.match(/class="item-title-name"[^>]*>([^<]+)</)?.[1]
            || card.match(/<img[^>]*\balt="([^"]+)"/)?.[1],
        );
        if (!name) continue;

        const priceRaw = card.match(/class="price[^"]*"[^>]*>\s*([^<]+?)\s*</)?.[1];
        const price = priceRaw && /[￥¥\d]/.test(priceRaw) ? clean(priceRaw) : null;

        seen.add(productId);
        rows.push({
            rank: rows.length + 1,
            product_id: productId,
            name,
            category: category.toLowerCase(),
            brand: brand.toLowerCase(),
            price,
            url: `https:${href}`,
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'pconline',
    name: 'list',
    access: 'read',
    aliases: ['browse'],
    description: '太平洋电脑网产品大全（按品类浏览 mobile/notebook/dc/cpu/vga… 返回名称 + 参考价 + 详情 URL）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'category', required: true, positional: true, help: '品类 slug，例如 mobile(手机) / notebook(笔记本) / dc(相机) / cpu / vga(显卡) / tabletpc(平板) / smartwatch' },
        { name: 'limit', type: 'int', default: 20, help: '返回的产品数量（最多 60）' },
    ],
    columns: LIST_COLUMNS,
    func: async (args) => {
        const category = String(args.category || '').trim().toLowerCase();
        if (!category || !/^[a-z]+$/.test(category)) {
            throw new ArgumentError(
                'category',
                `must be a slug like ${Object.keys(CATEGORIES).slice(0, 8).join(' / ')} …`,
            );
        }
        const limit = requireLimit(args.limit, 20, 60);

        const html = await pcFetch(`${PC_PRODUCT}/${category}/`, `list ${category}`);
        const rows = parseListRows(html, limit);
        if (rows.length === 0) {
            const known = CATEGORIES[category] ? '' : ` "${category}" 可能不是有效品类 slug —`;
            throw new EmptyResultError(
                `pconline list ${category}`,
                `${known} 试试 mobile / notebook / dc / cpu / vga / tabletpc / smartwatch。`,
            );
        }
        return rows;
    },
});
