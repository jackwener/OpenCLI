import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './product.js';
const { PRODUCT_COLUMNS, PRODUCT_FIELDS, mergeProductDetails, hasMeaningfulProductData, firstUrlFromSrcset, pickImageUrlFromAttributes, bindShopeeProductTab, ensureShopeeProductPage, } = await import('./product.js').then((m) => m.__test__);
describe('shopee product adapter', () => {
    const command = getRegistry().get('shopee/product');
    it('registers the command with correct shape', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('shopee');
        expect(command.name).toBe('product');
        expect(command.domain).toBe('shopee.sg');
        expect(command.strategy).toBe('cookie');
        expect(command.navigateBefore).toBe(false);
        expect(typeof command.func).toBe('function');
    });
    it('has url as a required positional arg', () => {
        const urlArg = command.args.find((arg) => arg.name === 'url');
        expect(urlArg).toBeDefined();
        expect(urlArg.required).toBe(true);
        expect(urlArg.positional).toBe(true);
    });
    it('includes key product fields in the output columns', () => {
        expect(PRODUCT_COLUMNS).toEqual(expect.arrayContaining([
            'product_url',
            'shopdora_login_message',
            'title',
            'rating_score',
            'shopdora_price_range',
            'shopee_current_price',
            'main_image_url',
            'video_urls',
            'thumbnail_urls',
            'image_variant_options',
            'text_variant_options',
            'detail_seller_name',
            'shop_display_name',
            'shop_url',
            'shop_product_list_url',
            'stock',
        ]));
        expect(command.columns).toEqual(expect.arrayContaining(PRODUCT_COLUMNS));
    });
    it('marks structured template fields with list metadata', () => {
        const titleField = PRODUCT_FIELDS.find((field) => field.name === 'title');
        const videoField = PRODUCT_FIELDS.find((field) => field.name === 'video_urls');
        const thumbnailField = PRODUCT_FIELDS.find((field) => field.name === 'thumbnail_urls');
        const attrOptionsField = PRODUCT_FIELDS.find((field) => field.name === 'image_variant_options');
        const specOptionsField = PRODUCT_FIELDS.find((field) => field.name === 'text_variant_options');
        const sales30dField = PRODUCT_FIELDS.find((field) => field.name === 'sales_30d');
        const totalGmvField = PRODUCT_FIELDS.find((field) => field.name === 'total_gmv');
        expect(titleField).toMatchObject({ transform: 'remove_buttons' });
        expect(videoField).toMatchObject({
            type: 'list',
            fields: [
                { name: 'video_urls', type: 'attribute', attribute: 'src', transform: 'absolute_url' },
            ],
        });
        expect(thumbnailField).toMatchObject({
            type: 'list',
            fields: [{ name: 'thumbnail_urls', type: 'attribute', attribute: 'src', transform: 'image_src' }],
        });
        expect(attrOptionsField).toMatchObject({
            type: 'list',
            fields: expect.arrayContaining([
                expect.objectContaining({ name: 'option_name', type: 'text' }),
                expect.objectContaining({ name: 'option_image_url', type: 'attribute', attribute: 'src', transform: 'image_src' }),
                expect.objectContaining({ name: 'is_selected', transform: 'selected_class' }),
            ]),
        });
        expect(specOptionsField).toMatchObject({
            type: 'list',
            fields: expect.arrayContaining([
                expect.objectContaining({ name: 'option_name', type: 'text' }),
                expect.objectContaining({ name: 'is_selected', transform: 'selected_class' }),
            ]),
        });
        expect(sales30dField).toMatchObject({
            type: 'labeled_text',
            lookupLabel: '30-Day Sales',
            valueSelector: '.item-main',
        });
        expect(totalGmvField).toMatchObject({
            type: 'labeled_text',
            lookupLabel: 'GMV',
            valueSelector: '.item-main',
        });
    });
});
describe('shopee attr option image helpers', () => {
    it('parses the first url from srcset values', () => {
        expect(firstUrlFromSrcset('https://down-sg.img.susercontent.com/file/sg-11134207-7rdwc-mcj4nu2ezjl22d@resize_w24_nl.webp 1x, https://down-sg.img.susercontent.com/file/sg-11134207-7rdwc-mcj4nu2ezjl22d@resize_w48_nl.webp 2x')).toBe('https://down-sg.img.susercontent.com/file/sg-11134207-7rdwc-mcj4nu2ezjl22d@resize_w24_nl.webp');
    });
    it('prefers the direct img src for shopee picture button attrs', () => {
        expect(pickImageUrlFromAttributes({
            src: 'https://down-sg.img.susercontent.com/file/sg-11134207-7rdwc-mcj4nu2ezjl22d',
            srcset: 'https://down-sg.img.susercontent.com/file/sg-11134207-7rdwc-mcj4nu2ezjl22d@resize_w24_nl 1x, https://down-sg.img.susercontent.com/file/sg-11134207-7rdwc-mcj4nu2ezjl22d@resize_w48_nl 2x',
        })).toBe('https://down-sg.img.susercontent.com/file/sg-11134207-7rdwc-mcj4nu2ezjl22d');
    });
});
describe('mergeProductDetails', () => {
    it('fills only missing fields from a later extraction pass', () => {
        expect(mergeProductDetails({ title: 'Product A', detail_seller_name: '', stock: '' }, { title: 'Product B', detail_seller_name: 'Shop 1', stock: '99' })).toEqual({
            title: 'Product A',
            detail_seller_name: 'Shop 1',
            stock: '99',
        });
    });
});
describe('hasMeaningfulProductData', () => {
    it('returns false for empty extraction rows', () => {
        expect(hasMeaningfulProductData({ title: '', detail_seller_name: '' })).toBe(false);
    });
    it('returns true once any mapped product field has content', () => {
        expect(hasMeaningfulProductData({ title: 'Wireless Earbuds' })).toBe(true);
    });
});
describe('product command Shopdora login annotations', () => {
    it('returns product data and includes a Shopdora login message when the soft login title is present', async () => {
        const command = getRegistry().get('shopee/product');
        const url = 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400';
        const goto = vi.fn(async () => { });
        const wait = vi.fn(async () => { });
        const scroll = vi.fn(async () => { });
        const evaluate = vi.fn(async (script) => {
            if (script.includes('.shopdoraLoginPage') && script.includes('.pageDetailLoginTitle')) {
                return { hasShopdoraLoginPage: false, hasPageDetailLoginTitle: true };
            }
            if (script.includes('const fields =') && script.includes('"title"')) {
                return { title: 'Wireless Earbuds' };
            }
            return { ok: true };
        });
        const page = { goto, wait, scroll, evaluate };
        await expect(command.func(page, { url })).resolves.toEqual([{
                product_url: url,
                title: 'Wireless Earbuds',
                shopdora_login_message: 'Shopdora 未登录',
            }]);
    });
});
describe('bindShopeeProductTab', () => {
    it('binds to the matching existing browser tab using the shopee workspace', async () => {
        const bindFn = vi.fn(async () => ({ tabId: 2 }));
        await expect(bindShopeeProductTab('https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400', bindFn)).resolves.toBe(true);
        expect(bindFn).toHaveBeenCalledWith('site:shopee', {
            matchUrl: 'https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-i.1058254930.25483790400',
        });
    });
    it('returns false when no existing browser tab matches the product url', async () => {
        const bindFn = vi.fn(async () => {
            throw new Error('No visible tab matching target');
        });
        await expect(bindShopeeProductTab('https://shopee.sg/product-i.1.2', bindFn)).resolves.toBe(false);
    });
});
describe('ensureShopeeProductPage', () => {
    it('reuses the matched tab and reloads the product page', async () => {
        const page = {
            goto: vi.fn(async () => { }),
            evaluate: vi.fn(async () => ({ ok: true, host: 'shopee.sg' })),
        };
        const bindFn = vi.fn(async () => ({ tabId: 2 }));
        await expect(ensureShopeeProductPage(page, 'https://shopee.sg/product-i.1.2', bindFn)).resolves.toBe(true);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://shopee.sg/product-i.1.2', { waitUntil: 'load' });
    });
    it('falls back to opening the product url when no existing tab is found', async () => {
        const page = {
            goto: vi.fn(async () => { }),
            evaluate: vi.fn(async () => ({ ok: true, host: 'shopee.sg' })),
        };
        const bindFn = vi.fn(async () => {
            throw new Error('not found');
        });
        await expect(ensureShopeeProductPage(page, 'https://shopee.sg/product-i.1.2', bindFn)).resolves.toBe(false);
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://shopee.sg/product-i.1.2', { waitUntil: 'load' });
    });
});
