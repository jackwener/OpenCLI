/**
 * dianping search — search shops/restaurants by keyword on a given city.
 *
 * Targets www.dianping.com (PC site). The PC site renders search results
 * server-side, so the func only needs to parse the SSR DOM after navigate.
 * m.dianping.com (mobile) is intentionally crippled for non-mobile UAs and
 * does not return data without app installation, so it's not used.
 *
 * The DOM extractor is defined as a plain top-level function and injected
 * into `page.evaluate` via `.toString()`, so the same code is exercised by
 * a JSDOM-against-frozen-fixture unit test (see dianping.test.js).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    SEARCH_COLUMNS,
    detectAuthOrPageFailure,
    parsePrice,
    parseReviewCount,
    requireSearchLimit,
    resolveCityId,
    wrapDianpingStep,
} from './utils.js';

/**
 * Pure DOM extractor for the dianping search-results page.
 *
 * Uses bare `document` / `location` so it runs identically in:
 *   - the live browser (injected via `${extractSearchRows.toString()}`)
 *   - JSDOM unit tests (which swap `globalThis.document` / `globalThis.location`)
 */
export function extractSearchRows() {
    const items = document.querySelectorAll('#shop-all-list li');
    if (items.length === 0) {
        const body = document.body;
        const sampleText = (body && (body.innerText || body.textContent)) || '';
        return {
            ok: false,
            sample: sampleText.slice(0, 800),
            url: location.href,
        };
    }
    const rows = [];
    items.forEach((el, i) => {
        const resultShape = el.querySelector('.tit h4, .review-num, .mean-price, .tag-addr')
            || el.querySelector('.tit a, a[data-shopid], a[href*="/shop/"]');
        if (!resultShape) return;

        const link = el.querySelector('.tit a[href*="/shop/"]')
            || el.querySelector('a[data-shopid]')
            || el.querySelector('a[href*="/shop/"]');
        const shopId = (link && link.getAttribute('data-shopid'))
            || (link && (link.getAttribute('href') || '').match(/\/shop\/([^?#/]+)/)?.[1])
            || '';
        const titleEl = el.querySelector('.tit h4');
        const name = (titleEl && titleEl.textContent && titleEl.textContent.trim())
            || (link && link.getAttribute('title'))
            || '';
        const reviewEl = el.querySelector('.review-num b');
        const reviewsRaw = (reviewEl && reviewEl.textContent && reviewEl.textContent.trim()) || '';
        const priceEl = el.querySelector('.mean-price b');
        const priceRaw = (priceEl && priceEl.textContent && priceEl.textContent.trim()) || '';
        const tagAddr = Array.from(el.querySelectorAll('.tag-addr .tag'))
            .map((t) => t.textContent.trim())
            .filter(Boolean);
        let starClass = '';
        const starWrap = el.querySelector('.nebula_star');
        if (starWrap) {
            const m = starWrap.outerHTML.match(/star_(\d{2})/g);
            if (m && m.length) {
                const last = m[m.length - 1];
                const lastDigits = last.match(/star_(\d{2})/)[1];
                starClass = lastDigits;
            }
        }
        rows.push({
            rank: i + 1,
            shop_id: shopId,
            name,
            starClass,
            reviewsRaw,
            priceRaw,
            cuisine: tagAddr[0] || '',
            district: tagAddr[1] || '',
            url: shopId ? 'https://www.dianping.com/shop/' + shopId : '',
        });
    });
    return { ok: true, rows };
}

cli({
    site: 'dianping',
    name: 'search',
    access: 'read',
    description: '大众点评店铺搜索（按关键词 + 城市）',
    domain: 'www.dianping.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'keyword', required: true, positional: true, help: '搜索关键词，例如 "火锅"' },
        { name: 'city', help: '城市名（北京/上海/beijing/...）或 cityId 数字。不传则使用 cookie 默认城市' },
        { name: 'limit', type: 'int', default: 15, help: '返回的店铺数量（最多 15，dianping 单页固定 15 条）' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (page, kwargs) => {
        const keyword = String(kwargs.keyword || '').trim();
        if (!keyword) throw new ArgumentError('keyword', 'must be a non-empty string');

        const limit = requireSearchLimit(kwargs.limit);

        const cityId = resolveCityId(kwargs.city);
        const path = cityId
            ? `/search/keyword/${cityId}/0_${encodeURIComponent(keyword)}`
            : `/search/keyword/0/0_${encodeURIComponent(keyword)}`;
        const url = `https://www.dianping.com${path}`;

        await wrapDianpingStep(`search "${keyword}" navigation`, async () => {
            await page.goto(url);
            await page.wait(2);
        });

        const result = await wrapDianpingStep(
            `search "${keyword}" extraction`,
            () => page.evaluate(`(${extractSearchRows.toString()})()`),
        );

        if (!result || !result.ok) {
            detectAuthOrPageFailure(
                { text: String(result?.sample || ''), url: String(result?.url || url) },
                `search "${keyword}"`,
                { emptyPatterns: [/没有找到|暂无结果|暂无商户|换个关键词|未找到相关/i] },
            );
        }

        const rows = (result.rows || []).slice(0, limit);
        if (rows.length === 0) {
            throw new CommandExecutionError('dianping search parser found no result-shaped shop cards');
        }
        if (rows.some((row) => !row?.shop_id)) {
            throw new CommandExecutionError('dianping search parser found result cards without shop_id values');
        }
        return rows.map((r) => ({
            rank: r.rank,
            shop_id: r.shop_id,
            name: r.name,
            rating: r.starClass ? Number((Number(r.starClass) / 10).toFixed(1)) : null,
            reviews: parseReviewCount(r.reviewsRaw),
            price: parsePrice(r.priceRaw),
            cuisine: r.cuisine,
            district: r.district,
            url: r.url,
        }));
    },
});
