import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './product.js';

const { PRODUCT_COLUMNS, normalizeShopeeProductUrl, mergeProductDetails, hasMeaningfulProductData } =
  await import('./product.js').then((m) => (m as typeof import('./product.js')).__test__);

describe('shopee product adapter', () => {
  const command = getRegistry().get('shopee/product');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command!.site).toBe('shopee');
    expect(command!.name).toBe('product');
    expect(command!.domain).toBe('shopee.sg');
    expect(command!.strategy).toBe('cookie');
    expect(command!.navigateBefore).toBe(false);
    expect(typeof command!.func).toBe('function');
  });

  it('has url as a required positional arg', () => {
    const urlArg = command!.args.find((arg) => arg.name === 'url');
    expect(urlArg).toBeDefined();
    expect(urlArg!.required).toBe(true);
    expect(urlArg!.positional).toBe(true);
  });

  it('includes key product fields in the output columns', () => {
    expect(PRODUCT_COLUMNS).toEqual(
      expect.arrayContaining([
        'product_url',
        'title',
        'rating_score',
        'current_price_range',
        'seller_name',
        'stock',
      ]),
    );
    expect(command!.columns).toEqual(expect.arrayContaining(PRODUCT_COLUMNS));
  });
});

describe('normalizeShopeeProductUrl', () => {
  it('accepts canonical Shopee product urls', () => {
    expect(
      normalizeShopeeProductUrl(
        'https://shopee.sg/Jeep-EW121-True-Wireless-i.1058254930.25483790400',
      ),
    ).toBe('https://shopee.sg/Jeep-EW121-True-Wireless-i.1058254930.25483790400');
  });

  it('accepts other shopee locales when the path matches a product page', () => {
    expect(normalizeShopeeProductUrl('https://shopee.ph/sample-product-i.12345.67890?x=1')).toBe(
      'https://shopee.ph/sample-product-i.12345.67890?x=1',
    );
  });

  it('rejects non-shopee hosts', () => {
    expect(() => normalizeShopeeProductUrl('https://example.com/item-i.1.2')).toThrow(
      'Unsupported Shopee host',
    );
  });

  it('rejects non-product shopee urls', () => {
    expect(() => normalizeShopeeProductUrl('https://shopee.sg/search?keyword=earbuds')).toThrow(
      'does not look like a Shopee product page',
    );
  });
});

describe('mergeProductDetails', () => {
  it('fills only missing fields from a later extraction pass', () => {
    expect(
      mergeProductDetails(
        { title: 'Product A', seller_name: '', stock: '' },
        { title: 'Product B', seller_name: 'Shop 1', stock: '99' },
      ),
    ).toEqual({
      title: 'Product A',
      seller_name: 'Shop 1',
      stock: '99',
    });
  });
});

describe('hasMeaningfulProductData', () => {
  it('returns false for empty extraction rows', () => {
    expect(hasMeaningfulProductData({ title: '', seller_name: '' })).toBe(false);
  });

  it('returns true once any mapped product field has content', () => {
    expect(hasMeaningfulProductData({ title: 'Wireless Earbuds' })).toBe(true);
  });
});
