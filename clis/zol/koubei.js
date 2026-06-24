/**
 * zol koubei — user reviews (口碑/点评) for a product.
 *
 * Hits `detail.zol.com.cn/0/<productId>/review.shtml` (the `/0/` segment
 * 301-redirects to the canonical numeric subcategory, which `fetch` follows)
 * and reads the 口碑 list. Each `comments-item` block carries the reviewer
 * name, a star bar (`<em style="width:96%">` → 4.8/5), the per-aspect
 * subscores (续航/拍照/性能/外观/性价比), the purchase date and the review
 * body, plus a link to the full write-up.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    ZOL_DETAIL,
    KOUBEI_COLUMNS,
    clean,
    snippet,
    starScore,
    normalizeProductId,
    requireLimit,
    zolFetch,
} from './utils.js';

/**
 * Pure parser: 口碑 HTML → review rows. Exported for unit testing against the
 * frozen fixture.
 *
 * Reviews render as repeated `comments-item` blocks; we slice on that marker
 * and pull each field by its stable inner class. The body lives in
 * `_j_CommentContent` when the user wrote prose; short ratings fall back to the
 * aspect title (e.g. 性价比). The star bar width is a percentage of five stars.
 */
export function parseKoubeiRows(html, limit) {
    const text = String(html || '');
    const starts = [];
    const ITEM_RE = /class="comments-item"/g;
    let mm;
    while ((mm = ITEM_RE.exec(text)) !== null) starts.push(mm.index);

    const rows = [];
    for (let i = 0; i < starts.length; i += 1) {
        const block = text.slice(starts[i], starts[i + 1] ?? text.length);

        const user = clean(block.match(/class="name"[^>]*>([^<]+)<\/a>/)?.[1]);
        if (!user) continue;

        const width = block.match(/class="star"[^>]*>\s*<em[^>]*style="[^"]*width:\s*([\d.]+)%/)?.[1];
        const score = starScore(width);

        const subscores = [];
        const SUB_RE = /<span>\s*([^：:<]{1,8})\s*[：:]\s*<em>(\d+)<\/em>/g;
        let s;
        while ((s = SUB_RE.exec(block)) !== null) {
            subscores.push(`${clean(s[1])}:${s[2]}`);
        }

        const date = block.match(/时间\s*[：:]\s*([0-9]{4}-[0-9]{2}(?:-[0-9]{2})?)/)?.[1] || null;

        const href = block.match(/href="(\/\d+\/\d+\/review_[^"#]+\.shtml)/)?.[1];
        const url = href ? `${ZOL_DETAIL}${href}` : null;

        const title = clean(block.match(/class="title"[^>]*>\s*<a[^>]*>([^<]+)<\/a>/)?.[1]);
        const body = block.match(/_j_CommentContent[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
        const content = snippet(body) || title;

        rows.push({
            rank: rows.length + 1,
            user,
            score,
            subscores: subscores.join(' ') || null,
            content: content || null,
            date,
            url,
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'zol',
    name: 'koubei',
    access: 'read',
    aliases: ['reviews'],
    description: '中关村在线产品口碑/用户点评（评分 / 续航·拍照·性能·外观分项 / 正文摘要）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'product', required: true, positional: true, help: '产品 id（来自 search 的 product_id 列）或 detail.zol.com.cn 详情页 URL' },
        { name: 'limit', type: 'int', default: 15, help: '返回的口碑条数（最多 20，单页 SSR 上限）' },
    ],
    columns: KOUBEI_COLUMNS,
    func: async (args) => {
        const productId = normalizeProductId(args.product);
        const limit = requireLimit(args.limit, 15, 20);
        const html = await zolFetch(
            `${ZOL_DETAIL}/0/${productId}/review.shtml`,
            `koubei ${productId}`,
        );
        const rows = parseKoubeiRows(html, limit);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `zol koubei ${productId}`,
                'No user reviews found — the product may be too new or the id may not exist.',
            );
        }
        return rows;
    },
});
