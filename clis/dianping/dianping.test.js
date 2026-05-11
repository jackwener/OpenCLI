import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    SEARCH_COLUMNS,
    SHOP_COLUMNS,
    detectAuthOrPageFailure,
    normalizeShopId,
    parsePrice,
    parseReviewCount,
    requireSearchLimit,
    resolveCityId,
} from './utils.js';
import { extractSearchRows } from './search.js';
import { extractShopFields } from './shop.js';
import {
    buildCitylistMap,
    clearCityResolverCache,
    extractCityIdFromPage,
    resolveCityIdAsync,
} from './cityResolver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOP_FIXTURE = readFileSync(join(__dirname, '__fixtures__/shop.html'), 'utf8');
const SEARCH_FIXTURE = readFileSync(join(__dirname, '__fixtures__/search.html'), 'utf8');

function createPageMock(evaluateResult, overrides = {}) {
    const evaluate = typeof evaluateResult === 'function'
        ? vi.fn(evaluateResult)
        : vi.fn().mockResolvedValue(evaluateResult);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        ...overrides,
    };
}

describe('dianping adapter — registration', () => {
    it('registers search and shop as cookie-browser read commands', () => {
        const search = getRegistry().get('dianping/search');
        const shop = getRegistry().get('dianping/shop');
        const detail = getRegistry().get('dianping/detail');

        expect(search).toBeDefined();
        expect(search.browser).toBe(true);
        expect(search.strategy).toBe('cookie');
        expect(search.columns).toEqual(SEARCH_COLUMNS);

        expect(shop).toBeDefined();
        expect(shop.browser).toBe(true);
        expect(shop.strategy).toBe('cookie');
        expect(shop.columns).toEqual(SHOP_COLUMNS);
        expect(detail).toBe(shop);
    });
});

describe('dianping adapter — helpers', () => {
    it('validates search limit for direct func callers', () => {
        expect(requireSearchLimit(undefined)).toBe(15);
        expect(requireSearchLimit('5')).toBe(5);
        expect(requireSearchLimit(15)).toBe(15);
        expect(() => requireSearchLimit('abc')).toThrow(ArgumentError);
        expect(() => requireSearchLimit('1.5')).toThrow(ArgumentError);
        expect(() => requireSearchLimit(0)).toThrow(ArgumentError);
        expect(() => requireSearchLimit(16)).toThrow(ArgumentError);
    });

    it('normalizes city, shop id, review count, and price inputs', () => {
        expect(resolveCityId('北京')).toBe(2);
        expect(resolveCityId('shanghai')).toBe(1);
        expect(resolveCityId('dalian')).toBe(19);
        expect(resolveCityId('shenyang')).toBe(18);
        expect(resolveCityId('123')).toBe(123);
        expect(resolveCityId('')).toBeNull();
        expect(() => resolveCityId('not-a-city')).toThrow(ArgumentError);

        expect(normalizeShopId('https://www.dianping.com/shop/GxJZ4urc9TnKE3kY?foo=1')).toBe('GxJZ4urc9TnKE3kY');
        expect(normalizeShopId('GxJZ4urc9TnKE3kY')).toBe('GxJZ4urc9TnKE3kY');
        expect(() => normalizeShopId('bad/id')).toThrow(ArgumentError);

        expect(parseReviewCount('1.2万条')).toBe(12000);
        expect(parseReviewCount('213 条评价')).toBe(213);
        expect(parseReviewCount('暂无')).toBeNull();
        expect(parsePrice('人均￥109')).toBe(109);
        expect(parsePrice('暂无')).toBeNull();
    });

    it('classifies captcha, login, explicit empty, and unknown no-data pages', () => {
        expect(() => detectAuthOrPageFailure({ url: 'https://verify.meituan.com/captcha' }, 'search'))
            .toThrow(AuthRequiredError);
        expect(() => detectAuthOrPageFailure({ text: '请先登录后继续访问' }, 'search'))
            .toThrow(AuthRequiredError);
        expect(() => detectAuthOrPageFailure(
            { text: '没有找到相关商户' },
            'search',
            { emptyPatterns: [/没有找到相关商户/] },
        )).toThrow(EmptyResultError);
        expect(() => detectAuthOrPageFailure({ text: '<html>unexpected shell</html>' }, 'search'))
            .toThrow(CommandExecutionError);
    });
});

describe('dianping adapter — async city resolver', () => {
    beforeEach(() => {
        clearCityResolverCache();
    });

    it('returns null/numeric/static-map ids without ever touching the page', async () => {
        const page = createPageMock({});

        expect(await resolveCityIdAsync(page, undefined)).toBeNull();
        expect(await resolveCityIdAsync(page, '')).toBeNull();
        expect(await resolveCityIdAsync(page, '   ')).toBeNull();
        expect(await resolveCityIdAsync(page, 47)).toBe(47);
        expect(await resolveCityIdAsync(page, '47')).toBe(47);
        expect(await resolveCityIdAsync(page, '北京')).toBe(2);
        expect(await resolveCityIdAsync(page, 'shanghai')).toBe(1);

        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('falls back to /<pinyin> for an unknown lowercase slug, then caches', async () => {
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockResolvedValue(207);
        const page = { goto, evaluate, wait: vi.fn() };

        expect(await resolveCityIdAsync(page, 'shantou')).toBe(207);
        expect(goto).toHaveBeenCalledTimes(1);
        expect(goto).toHaveBeenCalledWith('https://www.dianping.com/shantou');

        // Second call hits the in-process cache, no extra navigation.
        expect(await resolveCityIdAsync(page, 'shantou')).toBe(207);
        expect(goto).toHaveBeenCalledTimes(1);
    });

    it('resolves a Chinese name via /citylist + /<pinyin>, then caches both forms', async () => {
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn()
            .mockResolvedValueOnce({ '汕头': 'shantou', '佛山': 'foshan' })
            .mockResolvedValueOnce(207);
        const page = { goto, evaluate, wait: vi.fn() };

        expect(await resolveCityIdAsync(page, '汕头')).toBe(207);
        expect(goto).toHaveBeenNthCalledWith(1, 'https://www.dianping.com/citylist');
        expect(goto).toHaveBeenNthCalledWith(2, 'https://www.dianping.com/shantou');

        // Cached for the Chinese name AND the discovered pinyin.
        expect(await resolveCityIdAsync(page, '汕头')).toBe(207);
        expect(await resolveCityIdAsync(page, 'shantou')).toBe(207);
        expect(goto).toHaveBeenCalledTimes(2);
    });

    it('rejects mixed/garbage input with ArgumentError before any navigation', async () => {
        const page = createPageMock({});
        await expect(resolveCityIdAsync(page, 'not-a-city!')).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects a Chinese name that is not on /citylist with ArgumentError', async () => {
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockResolvedValueOnce({ '北京': 'beijing' });
        const page = { goto, evaluate, wait: vi.fn() };

        await expect(resolveCityIdAsync(page, '某虚构城')).rejects.toThrow(ArgumentError);
        expect(goto).toHaveBeenCalledTimes(1);
        expect(goto).toHaveBeenCalledWith('https://www.dianping.com/citylist');
    });

    it('throws CommandExecutionError when citylist renders without city anchors', async () => {
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockResolvedValueOnce({});
        const page = { goto, evaluate, wait: vi.fn() };

        await expect(resolveCityIdAsync(page, '汕头')).rejects.toThrow(CommandExecutionError);
        expect(goto).toHaveBeenCalledTimes(1);
        expect(goto).toHaveBeenCalledWith('https://www.dianping.com/citylist');
    });

    it('throws CommandExecutionError when the per-city page lacks a /search/keyword/{id}/ link', async () => {
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockResolvedValueOnce(null);
        const page = { goto, evaluate, wait: vi.fn() };

        await expect(resolveCityIdAsync(page, 'newcity')).rejects.toThrow(CommandExecutionError);
    });

    it('buildCitylistMap keeps Chinese-labeled city slugs and drops non-city paths', () => {
        const dom = new JSDOM(`
            <html><body>
                <a href="//www.dianping.com/shanghai">上海</a>
                <a href="//www.dianping.com/shantou">汕头</a>
                <a href="/beijing">北京</a>
                <a href="//www.dianping.com/citylist">更多城市 ></a>
                <a href="//www.dianping.com/promo">优惠</a>
                <a href="//www.dianping.com/shanghai">上海</a>
                <a href="https://www.dianping.com/member/123">可乐不加冰</a>
                <a href="https://example.com/notacity">东京</a>
            </body></html>
        `);
        globalThis.document = dom.window.document;

        try {
            const map = buildCitylistMap();
            expect(map['上海']).toBe('shanghai');
            expect(map['汕头']).toBe('shantou');
            expect(map['北京']).toBe('beijing');
            expect(map['更多城市 >']).toBeUndefined();
            expect(map['优惠']).toBeUndefined();
            expect(map['可乐不加冰']).toBeUndefined();
            expect(map['东京']).toBeUndefined();
        } finally {
            delete globalThis.document;
        }
    });

    it('extractCityIdFromPage pulls the cityId from the first /search/keyword/{id}/ link', () => {
        const dom = new JSDOM(`
            <html><body>
                <script>window.bad = "/search/keyword/999/";</script>
                <a href="https://example.com/search/keyword/888/0_x">wrong host</a>
                <a href="https://www.dianping.com.evil.com/search/keyword/666/0_x">host suffix</a>
                <a href="http://www.dianping.com/search/keyword/777/0_x">non-https</a>
                <a href="/search/keyword/207/0_%E5%88%BA%E8%BA%AB">刺身</a>
                <a href="/search/category/207/10">美食</a>
            </body></html>
        `, { url: 'https://www.dianping.com/shantou' });
        globalThis.document = dom.window.document;
        globalThis.location = dom.window.location;

        try {
            expect(extractCityIdFromPage()).toBe(207);
        } finally {
            delete globalThis.document;
            delete globalThis.location;
        }
    });

    it('extractCityIdFromPage returns null when no /search/keyword/{id}/ link exists', () => {
        const dom = new JSDOM(`<html><body><main>blocked</main></body></html>`);
        globalThis.document = dom.window.document;

        try {
            expect(extractCityIdFromPage()).toBeNull();
        } finally {
            delete globalThis.document;
        }
    });
});

describe('dianping adapter — search runtime', () => {
    const command = getRegistry().get('dianping/search');

    it('fails fast on invalid args before browser work', async () => {
        const page = createPageMock({ ok: true, rows: [] });

        await expect(command.func(page, { keyword: '   ', limit: 5 })).rejects.toThrow(ArgumentError);
        await expect(command.func(page, { keyword: '火锅', limit: 'abc' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('returns normalized rows for happy search results', async () => {
        const page = createPageMock({
            ok: true,
            rows: [{
                rank: 1,
                shop_id: 'GxJZ4urc9TnKE3kY',
                name: '  火锅店  ',
                starClass: '45',
                reviewsRaw: '1.2万条',
                priceRaw: '人均￥109',
                cuisine: '重庆火锅',
                district: '海淀区',
                url: 'https://www.dianping.com/shop/GxJZ4urc9TnKE3kY',
            }],
        });

        const rows = await command.func(page, { keyword: '火锅', city: '北京', limit: '1' });

        expect(page.goto).toHaveBeenCalledWith('https://www.dianping.com/search/keyword/2/0_%E7%81%AB%E9%94%85');
        expect(page.wait).toHaveBeenCalledWith(2);
        expect(rows).toEqual([{
            rank: 1,
            shop_id: 'GxJZ4urc9TnKE3kY',
            name: '  火锅店  ',
            rating: 4.5,
            reviews: 12000,
            price: 109,
            cuisine: '重庆火锅',
            district: '海淀区',
            url: 'https://www.dianping.com/shop/GxJZ4urc9TnKE3kY',
        }]);
    });

    it('maps explicit zero-result pages to EmptyResultError', async () => {
        const page = createPageMock({
            ok: false,
            sample: '没有找到相关商户，换个关键词试试',
            url: 'https://www.dianping.com/search/keyword/2/0_x',
        });

        await expect(command.func(page, { keyword: 'zzzxxyy', city: '北京' })).rejects.toThrow(EmptyResultError);
    });

    it('maps captcha pages to AuthRequiredError', async () => {
        const page = createPageMock({
            ok: false,
            sample: '请依次点击图中图标完成身份核实',
            url: 'https://verify.meituan.com/v2/web/general_page',
        });

        await expect(command.func(page, { keyword: '火锅' })).rejects.toThrow(AuthRequiredError);
    });

    it('maps selector drift and missing shop ids to CommandExecutionError', async () => {
        await expect(command.func(createPageMock({
            ok: false,
            sample: '<main>unexpected dianping layout</main>',
            url: 'https://www.dianping.com/search/keyword/2/0_x',
        }), { keyword: '火锅', city: 2 })).rejects.toThrow(CommandExecutionError);

        await expect(command.func(createPageMock({
            ok: true,
            rows: [{ rank: 1, shop_id: '', name: '火锅店' }],
        }), { keyword: '火锅', city: 2 })).rejects.toThrow(CommandExecutionError);

        await expect(command.func(createPageMock({
            ok: true,
            rows: [
                { rank: 1, shop_id: 'GxJZ4urc9TnKE3kY', name: '火锅店' },
                { rank: 2, shop_id: '', name: '缺 id 火锅店' },
            ],
        }), { keyword: '火锅', city: 2, limit: 2 })).rejects.toThrow(CommandExecutionError);
    });

    it('wraps browser navigation and evaluate failures as CommandExecutionError', async () => {
        await expect(command.func(createPageMock(
            { ok: true, rows: [] },
            { goto: vi.fn().mockRejectedValue(new Error('browser disconnected')) },
        ), { keyword: '火锅' })).rejects.toThrow(CommandExecutionError);

        await expect(command.func(createPageMock(() => {
            throw new Error('evaluate failed');
        }), { keyword: '火锅' })).rejects.toThrow(CommandExecutionError);
    });
});

describe('dianping adapter — shop runtime', () => {
    const command = getRegistry().get('dianping/shop');

    it('fails fast on invalid shop id before browser work', async () => {
        const page = createPageMock({ ok: true });

        await expect(command.func(page, { shop_id: '' })).rejects.toThrow(ArgumentError);
        await expect(command.func(page, { shop_id: 'bad/id' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('returns a field/value sheet and accepts a full shop URL', async () => {
        const page = createPageMock({
            ok: true,
            name: '火锅店',
            rating: '4.8',
            reviewsRaw: '321条',
            priceRaw: '￥109',
            breakdown: { '口味': 4.9, '环境': 4.7, '服务': 4.6 },
            features: ['可停车', '有包间'],
            address: '北京市海淀区',
            subway: '距地铁步行300m',
            hours: '营业中 11:00-22:00',
            rank: '海淀区 口味榜 · 第1名',
            url: 'https://www.dianping.com/shop/GxJZ4urc9TnKE3kY',
        });

        const rows = await command.func(page, {
            shop_id: 'https://www.dianping.com/shop/GxJZ4urc9TnKE3kY?foo=1',
        });

        expect(page.goto).toHaveBeenCalledWith('https://www.dianping.com/shop/GxJZ4urc9TnKE3kY');
        expect(rows).toContainEqual({ field: 'shop_id', value: 'GxJZ4urc9TnKE3kY' });
        expect(rows).toContainEqual({ field: 'rating', value: 4.8 });
        expect(rows).toContainEqual({ field: 'reviews', value: 321 });
        expect(rows).toContainEqual({ field: 'price', value: 109 });
        expect(rows).toContainEqual({ field: 'taste', value: 4.9 });
        expect(rows).toContainEqual({ field: 'ingredients', value: null });
        expect(rows).toContainEqual({ field: 'features', value: '可停车, 有包间' });
    });

    it('maps captcha, not-found, and selector drift to distinct typed errors', async () => {
        await expect(command.func(createPageMock({
            ok: false,
            sample: '身份核实 请依次点击',
            url: 'https://verify.meituan.com/v2/web/general_page',
        }), { shop_id: 'GxJZ4urc9TnKE3kY' })).rejects.toThrow(AuthRequiredError);

        await expect(command.func(createPageMock({
            ok: false,
            sample: '商户不存在或店铺已关闭',
            url: 'https://www.dianping.com/shop/missing',
        }), { shop_id: 'missing' })).rejects.toThrow(EmptyResultError);

        await expect(command.func(createPageMock({
            ok: false,
            sample: '<main>new shop shell without expected selectors</main>',
            url: 'https://www.dianping.com/shop/GxJZ4urc9TnKE3kY',
        }), { shop_id: 'GxJZ4urc9TnKE3kY' })).rejects.toThrow(CommandExecutionError);
    });

    it('wraps browser navigation and evaluate failures as CommandExecutionError', async () => {
        await expect(command.func(createPageMock(
            { ok: true },
            { goto: vi.fn().mockRejectedValue(new Error('browser disconnected')) },
        ), { shop_id: 'GxJZ4urc9TnKE3kY' })).rejects.toThrow(CommandExecutionError);

        await expect(command.func(createPageMock(() => {
            throw new Error('evaluate failed');
        }), { shop_id: 'GxJZ4urc9TnKE3kY' })).rejects.toThrow(CommandExecutionError);
    });
});

/**
 * In-browser DOM extractors against frozen sanitized HTML fixtures.
 *
 * The mocked-page.evaluate tests above can't catch silent bugs that live
 * inside the IIFE — they feed pre-baked results to the func and the real
 * DOM walk never runs. PR #1312 found two such bugs only on live verify:
 *
 *   1. shop title fallback split on ASCII `[]` while dianping renders
 *      full-width `【】`, so `name` was always empty.
 *   2. headText `\s+` collapse fused rating "4.8" with "21241条", so a
 *      head-wide /\d+条/ regex captured "4.821241" → 5.
 *
 * These tests replay the real (sanitized) HTML through JSDOM so changes
 * to the extractor logic that re-introduce either bug fail in CI.
 */
describe('dianping adapter — extractors against frozen HTML fixtures', () => {
    let originalDocument;
    let originalLocation;

    beforeEach(() => {
        originalDocument = globalThis.document;
        originalLocation = globalThis.location;
    });

    afterEach(() => {
        globalThis.document = originalDocument;
        globalThis.location = originalLocation;
    });

    function loadFixture(html, url) {
        const dom = new JSDOM(html, { url });
        globalThis.document = dom.window.document;
        globalThis.location = dom.window.location;
        return dom;
    }

    it('extractShopFields recovers name from full-width 【】 title and avoids rating/reviews fusion', () => {
        loadFixture(SHOP_FIXTURE, 'https://www.dianping.com/shop/H20FrTRI6kbXbgTu');

        const data = extractShopFields();

        expect(data.ok).toBe(true);
        // Regression guard for #1312 bug #1: title is "【芈重山老火锅(五道口店)】..."
        // (full-width brackets); ASCII `[]` split would leave name empty here.
        expect(data.name).toBe('芈重山老火锅(五道口店)');
        // Regression guard for #1312 bug #2: .reviews selector returns "21241条" cleanly,
        // while a head-wide /\d+条/ on the whitespace-collapsed headText would catch
        // "4.821241条" → 5. Asserting the raw string excludes both regressions.
        expect(data.reviewsRaw).toBe('21241条');
        expect(data.rating).toBe('4.8');
        expect(data.priceRaw).toBe('¥109');
        expect(data.breakdown).toEqual({
            '口味': 4.8,
            '环境': 4.8,
            '服务': 4.8,
            '食材': 4.9,
        });
        expect(data.hours).toBe('营业中11:00-次日02:00');
        expect(data.rank).toBe('海淀区重庆火锅口味榜 · 第1名');
        expect(data.subway).toBe('距地铁13号线五道口站A北口步行90m');
        expect(data.url).toBe('https://www.dianping.com/shop/H20FrTRI6kbXbgTu');
    });

    it('extractSearchRows returns three result-shaped rows with shop_id, name, reviews, price, star, tags', () => {
        loadFixture(SEARCH_FIXTURE, 'https://www.dianping.com/search/keyword/2/0_%E7%81%AB%E9%94%85');

        const result = extractSearchRows();

        expect(result.ok).toBe(true);
        expect(result.rows).toHaveLength(3);

        // First row carries the rating + review fusion bug for shop fixture too;
        // here we lock in the per-card breakdown to prove every row has its own
        // identity (no silent fall-through to row[0] data).
        expect(result.rows[0]).toMatchObject({
            rank: 1,
            shop_id: 'H20FrTRI6kbXbgTu',
            name: '芈重山老火锅(五道口店)',
            starClass: '50',
            reviewsRaw: '21231',
            priceRaw: '￥109',
            cuisine: '重庆火锅',
            district: '五道口',
            url: 'https://www.dianping.com/shop/H20FrTRI6kbXbgTu',
        });
        expect(result.rows[1]).toMatchObject({
            rank: 2,
            shop_id: 'H6uJDRHtNUreCoBa',
            name: '百年前门铜锅涮肉(前门总店)',
            starClass: '45',
            reviewsRaw: '15649',
            priceRaw: '￥81',
            cuisine: '老北京火锅',
            district: '前门/大栅栏',
        });
        expect(result.rows[2]).toMatchObject({
            rank: 3,
            shop_id: 'H7gQoQ1L5p7CoUEs',
            name: '东来顺饭庄(前门大街店)',
            starClass: '50',
            reviewsRaw: '21537',
            priceRaw: '￥124',
        });

        // Round-trip through the public adapter mappers (parseReviewCount /
        // parsePrice / star → rating) — this is what the live func does after
        // the extractor returns. Catches drift between extractor + post-process.
        const finalRows = result.rows.map((r) => ({
            shop_id: r.shop_id,
            rating: r.starClass ? Number((Number(r.starClass) / 10).toFixed(1)) : null,
            reviews: parseReviewCount(r.reviewsRaw),
            price: parsePrice(r.priceRaw),
        }));
        expect(finalRows).toEqual([
            { shop_id: 'H20FrTRI6kbXbgTu', rating: 5.0, reviews: 21231, price: 109 },
            { shop_id: 'H6uJDRHtNUreCoBa', rating: 4.5, reviews: 15649, price: 81 },
            { shop_id: 'H7gQoQ1L5p7CoUEs', rating: 5.0, reviews: 21537, price: 124 },
        ]);
    });

    it('extractShopFields signals ok:false with a sample when shop-head is missing', () => {
        loadFixture(
            '<html><head><title>blocked</title></head><body><main>验证码</main></body></html>',
            'https://verify.meituan.com/v2/web/general_page',
        );

        const data = extractShopFields();

        expect(data.ok).toBe(false);
        expect(data.url).toBe('https://verify.meituan.com/v2/web/general_page');
        expect(data.sample).toContain('验证码');
    });

    it('extractSearchRows signals ok:false with a sample when shop-all-list is empty', () => {
        loadFixture(
            '<html><head><title>blocked</title></head><body><main>没有找到相关</main><ul id="shop-all-list"></ul></body></html>',
            'https://www.dianping.com/search/keyword/2/0_zzz',
        );

        const result = extractSearchRows();

        expect(result.ok).toBe(false);
        expect(result.sample).toContain('没有找到相关');
        expect(result.url).toBe('https://www.dianping.com/search/keyword/2/0_zzz');
    });
});
