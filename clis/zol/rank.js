/**
 * zol rank — ZOL hot-product rankings (排行榜).
 *
 * Hits `top.zol.com.cn` and reads the 热门排行 boards (手机 / 笔记本电脑 /
 * 空调 / 显示器 / 数码相机 …). It's the discovery counterpart to `search`:
 * surface popular products — with their `product_id` — without knowing a
 * keyword, then feed an id into `param` / `price` / `koubei`.
 *
 * Each board is a `rank-module__head` title followed by a `rank-list` of
 * `<li>` rows (rank number + product anchor + price). The 品牌排行榜 board has
 * no product detail links, so it naturally drops out of the product rows.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    ZOL_TOP,
    RANK_COLUMNS,
    clean,
    requireLimit,
    zolFetch,
} from './utils.js';

/**
 * Pure parser: rankings HTML → product rows. Exported for unit testing.
 *
 * Splits the page into boards on `rank-module__head`, normalizes each title to
 * a bare category (strip the `ZOL热门…排行` chrome), then reads each `<li>`
 * row. When `category` is given, only boards whose title contains it are kept.
 */
export function parseRankRows(html, { category, limit }) {
    const text = String(html || '');
    const heads = [];
    const HEAD_RE = /class="rank-module__head"[^>]*>([^<]+)</g;
    let h;
    while ((h = HEAD_RE.exec(text)) !== null) {
        heads.push({ end: HEAD_RE.lastIndex, idx: h.index, title: h[1] });
    }

    const ROW_RE =
        /rank-list__number[^>]*>(\d+)[\s\S]*?rank-list__name"[^>]*>\s*<a[^>]*href="(https?:\/\/detail\.zol\.com\.cn\/[^"]*index(\d+)\.shtml)"[^>]*>([^<]+)<\/a>[\s\S]*?rank-list__price"[^>]*>([\s\S]*?)<\/div>/g;

    const rows = [];
    for (let i = 0; i < heads.length; i += 1) {
        const board = text.slice(heads[i].end, heads[i + 1]?.idx ?? text.length);
        const cat = clean(heads[i].title).replace(/^ZOL热门/, '').replace(/排行榜?$/, '').trim();
        if (category && !cat.includes(category)) continue;
        ROW_RE.lastIndex = 0;
        let m;
        while ((m = ROW_RE.exec(board)) !== null) {
            rows.push({
                category: cat,
                rank: Number(m[1]),
                product_id: m[3],
                name: clean(m[4]),
                price: clean(m[5]) || null,
                url: m[2],
            });
            if (rows.length >= limit) return rows;
        }
    }
    return rows;
}

cli({
    site: 'zol',
    name: 'rank',
    access: 'read',
    aliases: ['top'],
    description: '中关村在线热门产品排行榜（手机/笔记本/显示器等热门榜，返回产品 id 供进一步查询）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'category', help: '只看某品类的榜单，例如 手机 / 笔记本 / 显示器 / 相机（缺省返回全部榜单）' },
        { name: 'limit', type: 'int', default: 20, help: '返回的产品数量（最多 100）' },
    ],
    columns: RANK_COLUMNS,
    func: async (args) => {
        const category = clean(args.category) || null;
        const limit = requireLimit(args.limit, 20, 100);
        const html = await zolFetch(`${ZOL_TOP}/`, 'rank');
        const rows = parseRankRows(html, { category, limit });
        if (rows.length === 0) {
            throw new EmptyResultError(
                category ? `zol rank ${category}` : 'zol rank',
                category
                    ? '该品类暂无榜单 — 试试 手机 / 笔记本 / 显示器 / 空调 / 相机。'
                    : 'No ranking rows found — ZOL may have changed its rankings page.',
            );
        }
        return rows;
    },
});
