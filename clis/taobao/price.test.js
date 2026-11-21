import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './detail.js';
import './search.js';
import {
    buildTaobaoPriceModel,
    buildTaobaoPriceModelFromState,
    extractTaobaoDiscountBreakdown,
    normalizeTaobaoSearchPrice,
} from './price.js';

describe('taobao price semantics', () => {
    it('keeps the prices observed in live page state aligned with rendered labels', () => {
        const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/pricing.capture.json', import.meta.url), 'utf8'));
        const { pricing } = buildTaobaoPriceModelFromState(fixture.state);
        expect(fixture.observedLabels).toEqual(expect.arrayContaining([
            '优惠前￥9999起', '平台加补后￥8414.16起',
        ]));
        expect(pricing.listing).toMatchObject({ amount: 9999, scope: 'range_floor', source_kind: 'page_state' });
        expect(pricing.estimated).toMatchObject({ amount: 8414.16, state: 'observed' });
        expect(pricing.checkout.amount).toBeNull();
    });

    it('reads listing and explicit platform estimate from page state', () => {
        const model = buildTaobaoPriceModelFromState({
            item: {
                itemId: '1025944799499',
                title: 'Apple MacBook Air',
            },
            componentsVO: {
                priceVO: {
                    price: { priceTitle: '优惠前', priceText: '9999', priceDesc: '起', priceUnit: '￥' },
                    extraPrice: { priceTitle: '平台加补后', priceText: '7734.16', priceDesc: '起', priceUnit: '￥' },
                },
            },
            skuCore: {
                sku2info: {
                    0: { price: { priceText: '9999' } },
                    6117431788311: {
                        price: { priceText: '9999', priceMoney: '999900' },
                        subPrice: { priceText: '7734.16', priceMoney: '773416' },
                        quantity: 0,
                    },
                    6117431788307: {
                        price: { priceText: '12249', priceMoney: '1224900' },
                        subPrice: { priceText: '9826.51', priceMoney: '982651' },
                        quantity: 80,
                    },
                },
            },
            skuBase: {
                props: [
                    {
                        pid: '1627207',
                        name: '颜色分类',
                        valueMap: { 28330: { name: '银色' } },
                    },
                ],
                skus: [
                    { skuId: '6117431788307', propPath: '1627207:28330' },
                ],
            },
        });

        expect(model.itemId).toBe('1025944799499');
        expect(model.pricing.listing.amount).toBe(9999);
        expect(model.pricing.listing.scope).toBe('range_floor');
        expect(model.pricing.estimated.amount).toBe(7734.16);
        expect(model.pricing.checkout.state).toBe('not_attempted');
        expect(model.skus).toHaveLength(2);
        expect(model.skus[1]).toMatchObject({
            sku_id: '6117431788307',
            name: '银色',
            listing_price: 12249,
            estimated_payable: 9826.51,
        });
    });

    it('prefers the scoped 优惠前 node and never takes a minimum across unrelated page amounts', () => {
        const pricing = buildTaobaoPriceModel([
            {
                text: '¥9949',
                context: '第三方扩展注入的其它商品 ¥9949',
                selector: 'span.injected-price',
            },
            {
                text: '优惠前￥9999起',
                context: '平台加补后￥7734.16起 优惠前￥9999起',
                selector: 'div.subPrice',
            },
            {
                text: '平台加补后￥7734.16起',
                context: '平台加补后￥7734.16起',
                selector: 'div.highlightPrice',
            },
        ]);

        expect(pricing.listing.amount).toBe(9999);
        expect(pricing.estimated.amount).toBe(7734.16);
        expect(pricing.listing.amount).not.toBe(9949);
    });

    it('extracts only explicit observed coupon, subsidy, and coin amounts', () => {
        expect(extractTaobaoDiscountBreakdown(
            '已享受: 满8000减800 淘金币已抵99.99元 领国家补贴省1364.85 以旧换新立减200元',
        )).toEqual({
            coupon_amount: 800,
            subsidy_amount: 1364.85,
            coin_discount_amount: 99.99,
            exchange_eligibility: '以旧换新立减200',
        });
    });

    it('reads observed subsidy amounts without confusing a subsidy percentage with money', () => {
        const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/pricing.capture.json', import.meta.url), 'utf8'));
        expect(extractTaobaoDiscountBreakdown(fixture.observedDiscountText)).toMatchObject({
            subsidy_amount: 1484.85, coin_discount_amount: 99.99,
        });
        expect(extractTaobaoDiscountBreakdown('国补15%')).toMatchObject({ subsidy_amount: null });
    });

    it('does not call an unlabeled search-card amount a listing price', () => {
        expect(normalizeTaobaoSearchPrice('¥7819.15', '7819 .15')).toMatchObject({
            price_basis: 'displayed_card',
            listing_price: null,
            price_num: 7819.15,
        });
    });

    it('does not treat an available coupon as an already-adjusted price', () => {
        expect(normalizeTaobaoSearchPrice('¥1000', '可用券 满1000减100')).toMatchObject({
            price_num: 1000,
            price_basis: 'displayed_card',
            coupon_price: null,
        });
        expect(buildTaobaoPriceModel([{ text: '优惠券￥100', context: '可用券 满1000减100', selector: 'span.coupon' }]).coupon.amount).toBeNull();
    });

    it('rejects an untrusted injected price when page state is unavailable', () => {
        const pricing = buildTaobaoPriceModel([
            {
                text: '¥9949',
                context: 'Apple产品本地服务专营店 ¥9949',
                selector: 'span.injected-price',
            },
        ]);
        expect(pricing.listing.amount).toBeNull();
        expect(pricing.listing.state).toBe('not_present');
    });
});

describe('taobao price command output', () => {
    it('keeps coupon discounts distinct and preserves non-price detail fields', async () => {
        const dom = new JSDOM(`<title>示例商品</title><body>
            <div id="right-content-area">
                <div class="subPrice">优惠前￥1000</div>
                <div class="priceText">券后￥900</div>
                <div>满1000减100 ￥900</div>
            </div>
        </body>`, { url: 'https://item.taobao.com/item.htm?id=123', runScripts: 'outside-only' });
        Object.defineProperty(dom.window.document.body, 'innerText', { value:
            '123人付款\n累计评价 456\n4.8分\n示例旗舰店\n发货地：浙江省\n颜色分类\n红色 XL\n蓝色 XL' });
        const page = {
            goto: async () => {},
            wait: async () => {},
            evaluate: async script => String(script).startsWith('location.href =')
                ? undefined : dom.window.eval(script),
        };
        try {
            const rows = await getRegistry().get('taobao/detail').func(page, { id: '123' });
            const fields = Object.fromEntries(rows.map(({ field, value }) => [field, value]));
            expect(fields).toMatchObject({
                '商品标价': '优惠前￥1000',
                '优惠券金额': 100,
                '券后价': '券后￥900',
                '销量': '123人付款',
                '评价数': '456',
                '店铺评分': '4.8分',
                '店铺': '示例旗舰店',
                '发货地': '浙江省',
                '可选规格': '颜色分类 | 红色 XL | 蓝色 XL',
            });
        } finally {
            dom.window.close();
        }
    });

    it('returns only declared search columns while using price context internally', async () => {
        const command = getRegistry().get('taobao/search');
        let calls = 0;
        const page = {
            goto: async () => {}, wait: async () => {}, autoScroll: async () => {},
            evaluate: async () => {
                if (++calls === 1) return undefined;
                if (calls === 2) return 'ok';
                return { results: [{
                    rank: 1, title: '示例商品', priceRaw: { display: '¥900', context: '券后￥900' },
                    sales: '', shop: '', location: '', item_id: '123', url: 'https://item.taobao.com/item.htm?id=123',
                }] };
            },
        };
        const [row] = await command.func(page, { query: '示例商品', limit: 1 });
        expect(row).toMatchObject({ price_num: 900, coupon_price: 900, price_basis: 'coupon' });
        expect(Object.keys(row).sort()).toEqual([...command.columns].sort());
    });
});
