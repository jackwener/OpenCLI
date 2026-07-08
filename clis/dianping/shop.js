/**
 * dianping shop — read shop detail by shop ID (the alphanumeric handle in
 * `https://www.dianping.com/shop/<shop_id>`).
 *
 * Returns a key/value sheet so the table view stays readable when fields
 * are absent (phone is hidden on PC web — only shows in app — so the row
 * surfaces it as `null` rather than fabricating).
 *
 * The DOM extractor is defined as a plain top-level function and injected
 * into `page.evaluate` via `.toString()`, so the same code is exercised by
 * a JSDOM-against-frozen-fixture unit test (see dianping.test.js). Mocked
 * `page.evaluate` tests can't catch in-browser bugs like the original
 * full-width `【】` vs ASCII `[]` mismatch — fixture tests can.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    SHOP_COLUMNS,
    detectAuthOrPageFailure,
    normalizeShopId,
    parsePrice,
    parseReviewCount,
    wrapDianpingStep,
} from './utils.js';

/**
 * Pure DOM extractor for the dianping shop page.
 *
 * Uses bare `document` / `location` so it runs identically in:
 *   - the live browser (injected via `${extractShopFields.toString()}`)
 *   - JSDOM unit tests (which swap `globalThis.document` / `globalThis.location`)
 *
 * Returns either `{ ok: true, ...fields }` on success or
 * `{ ok: false, sample, url }` so the caller can classify the failure.
 */
export function extractShopFields() {
    const head = document.querySelector('.shop-head');
    if (!head) {
        const body = document.body;
        const sampleText = (body && (body.innerText || body.textContent)) || '';
        return {
            ok: false,
            sample: sampleText.slice(0, 800),
            url: location.href,
        };
    }
    const headText = head.textContent.trim().replace(/\s+/g, ' ');
    // Shop name: dianping puts it as "【芈重山老火锅(五道口店)】" at
    // the head of document.title (full-width 【】, not ASCII []).
    // Try selectors first, then fall back to title parsing.
    const titleEl = document.querySelector('.shop-name, .shop-head h2, .shop-head h1');
    let name = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || '';
    if (!name) {
        const t = document.title || '';
        const m = t.match(/【([^】]+)】/);
        if (m) name = m[1].trim();
    }
    const ratingEl = document.querySelector('.star-score');
    const ratingText = (ratingEl && ratingEl.textContent && ratingEl.textContent.trim()) || '';
    const features = Array.from(document.querySelectorAll('.shop-feature'))
        .map((f) => f.textContent.trim())
        .filter(Boolean);
    const addressEl = document.querySelector('.desc-info');
    const address = (addressEl && addressEl.textContent && addressEl.textContent.trim()) || '';
    const subwayMatch = headText.match(/距(?:地铁)?[^\s]+?步行\d+m/);
    const subway = subwayMatch ? subwayMatch[0] : '';

    // Reviews: prefer .reviews / .review-num selector — its text is
    // "21241条" cleanly. Whitespace-collapsed headText fuses the
    // rating "4.8" with review digits ("4.821241条"), so a
    // head-wide /\d+条/ regex captures "4.821241" and rounds to 5.
    const reviewEl = document.querySelector('.reviews, .review-num, .reviewCount, .reviewCountSentence');
    let reviewsRaw = (reviewEl && reviewEl.textContent && reviewEl.textContent.trim()) || '';
    if (!reviewsRaw) {
        const titleReviewEl = document.querySelector('.review-title');
        const titleText = titleReviewEl && titleReviewEl.textContent;
        const titleM = titleText && titleText.match(/评价\(([\d.,万]+)\)/);
        if (titleM) reviewsRaw = titleM[1];
    }

    // Shop-head text holds price + cuisine + district + rank.
    const priceMatch = headText.match(/[¥￥]\s*\d+(?:\.\d+)?/);

    // Try to read score breakdown ("口味:4.8 环境:4.8 服务:4.8 食材:4.9").
    const breakdown = {};
    const breakKeys = ['口味', '环境', '服务', '食材'];
    for (const key of breakKeys) {
        const m = headText.match(new RegExp(key + '[:：]\\s*([0-9.]+)'));
        if (m) breakdown[key] = Number(m[1]);
    }

    // Hours: "营业中 11:00-次日02:00" / "今日休息".
    const hoursMatch = headText.match(/营业中[^\s]*\d{1,2}:\d{2}-(?:次日)?\d{1,2}:\d{2}|今日休息|暂停营业/);

    // Rank line: "海淀区 重庆火锅 口味榜 · 第1名".
    const rankMatch = headText.match(/[^\s]+?(?:口味|人气|环境|服务)榜\s*[·•]\s*第\d+名/);

    return {
        ok: true,
        name,
        rating: ratingText,
        reviewsRaw,
        priceRaw: (priceMatch && priceMatch[0]) || '',
        breakdown,
        features,
        address,
        subway,
        hours: (hoursMatch && hoursMatch[0]) || '',
        rank: (rankMatch && rankMatch[0]) || '',
        url: location.href,
    };
}

cli({
    site: 'dianping',
    name: 'shop',
    access: 'read',
    aliases: ['detail'],
    description: '大众点评店铺详情（按 shop_id）',
    domain: 'www.dianping.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'shop_id', required: true, positional: true, help: '店铺 ID（来自 search 的 shop_id 列，或 https://www.dianping.com/shop/<id> URL 段）' },
    ],
    columns: SHOP_COLUMNS,
    func: async (page, kwargs) => {
        const shopId = normalizeShopId(kwargs.shop_id);

        const url = `https://www.dianping.com/shop/${shopId}`;
        await wrapDianpingStep(`shop ${shopId} navigation`, async () => {
            await page.goto(url);
            await page.wait(3);
        });

        const data = await wrapDianpingStep(
            `shop ${shopId} extraction`,
            () => page.evaluate(`(${extractShopFields.toString()})()`),
        );

        if (!data || !data.ok) {
            detectAuthOrPageFailure(
                { text: String(data?.sample || ''), url: String(data?.url || url) },
                `shop ${shopId}`,
                { emptyPatterns: [/商户不存在|店铺不存在|店铺已关闭|页面不存在|404|已下线|没有找到相关商户/i] },
            );
        }

        const rating = data.rating ? Number(data.rating) : null;
        const reviews = parseReviewCount(data.reviewsRaw);
        const price = parsePrice(data.priceRaw);
        const breakdown = data.breakdown || {};

        const fields = [
            ['shop_id', shopId],
            ['name', data.name || ''],
            ['rating', Number.isFinite(rating) ? rating : null],
            ['reviews', reviews],
            ['price', price],
            ['rank', data.rank || ''],
            ['taste', Number.isFinite(breakdown['口味']) ? breakdown['口味'] : null],
            ['environment', Number.isFinite(breakdown['环境']) ? breakdown['环境'] : null],
            ['service', Number.isFinite(breakdown['服务']) ? breakdown['服务'] : null],
            ['ingredients', Number.isFinite(breakdown['食材']) ? breakdown['食材'] : null],
            ['hours', data.hours || ''],
            ['address', data.address || ''],
            ['subway', data.subway || ''],
            ['features', (data.features || []).join(', ')],
            ['url', data.url || url],
        ];

        return fields.map(([field, value]) => ({ field, value }));
    },
});
