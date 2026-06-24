/**
 * pconline search — keyword product search via 快搜 (ks.pconline.com.cn).
 *
 * Unlike the rest of this adapter, search is a **browser** command: the 快搜
 * results page sits behind a slide-captcha anti-bot challenge, so a plain
 * `fetch` gets HTTP 503. It renders fine in a real (logged-in) Chrome, so this
 * command drives the browser bridge, lets the page render, then parses the
 * server-rendered result list out of the DOM HTML.
 *
 * Each result is a `.item-wrap` card: `.item-name[title]` (the clean product
 * name), an `.item-pic` anchor to the 产品库 detail page (→ category/brand/id),
 * and a `￥<price>` link. The parsed `url` feeds `param` / `info`; the bare id
 * feeds `price`.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    PC_KS,
    SEARCH_COLUMNS,
    clean,
    stripHtml,
    requireLimit,
} from './utils.js';

/**
 * Pure parser: rendered 快搜 HTML → product rows. Exported for unit testing
 * against the frozen fixture, and reused by the live command on the DOM HTML
 * the browser returns.
 *
 * Slices on each `.item-wrap` card, keeps only cards linking to a 产品库 detail
 * page (`product.pconline.com.cn/<cat>/<brand>/<id>.html` — the `_price.html`
 * variant is ignored by the `\d+\.html` anchor), reads the clean name from the
 * `item-name` title attr and the price from the first `￥` figure. Deduped by id.
 */
export function parseSearchRows(html, limit) {
    const text = String(html || '');
    const starts = [];
    const RE = /class="item-wrap"/g;
    let mm;
    while ((mm = RE.exec(text)) !== null) starts.push(mm.index);

    const rows = [];
    const seen = new Set();
    for (let i = 0; i < starts.length; i += 1) {
        const block = text.slice(starts[i], starts[i + 1] ?? text.length);
        const link = block.match(/href="(\/\/product\.pconline\.com\.cn\/([a-z]+)\/([a-z0-9]+)\/(\d+)\.html)"/i);
        if (!link) continue;
        const [, href, category, , productId] = link;
        if (seen.has(productId)) continue;

        const name = clean(
            block.match(/class="item-name"[^>]*\btitle="([^"]*)"/)?.[1]
            || stripHtml(block.match(/class="item-name"[^>]*>([\s\S]*?)<\/a>/)?.[1]),
        );
        if (!name) continue;

        const priceM = stripHtml(block).match(/[￥¥]\s*([\d,]+)/);
        const price = priceM ? `￥${priceM[1].replace(/,/g, '')}` : null;

        seen.add(productId);
        rows.push({
            rank: rows.length + 1,
            product_id: productId,
            name,
            category: category.toLowerCase(),
            price,
            url: `https:${href}`,
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'pconline',
    name: 'search',
    access: 'read',
    description: '太平洋电脑网产品搜索（快搜，按关键词返回名称 + 报价 + 产品 URL；走登录态浏览器绕过 slide-captcha 反爬）',
    domain: 'pconline.com.cn',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'keyword', required: true, positional: true, help: '搜索关键词，例如 "iPhone 15" 或 "ThinkPad X1"' },
        { name: 'limit', type: 'int', default: 20, help: '返回的产品数量（最多 40）' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (page, args) => {
        const keyword = String(args.keyword || '').trim();
        if (!keyword) throw new ArgumentError('keyword', 'must be a non-empty string');
        const limit = requireLimit(args.limit, 20, 40);

        await page.goto(
            `${PC_KS}/product.shtml?q=${encodeURIComponent(keyword)}`,
            { waitUntil: 'load', settleMs: 2500 },
        );
        await page.wait({ time: 2 });

        const html = await page.evaluate('document.body.innerHTML');
        const rows = parseSearchRows(html, limit);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `pconline search "${keyword}"`,
                'No products found — try a model name (e.g. "iPhone 15"), or the 快搜 anti-bot '
                + 'challenge may not have cleared (this command needs a real logged-in Chrome).',
            );
        }
        return rows;
    },
});
