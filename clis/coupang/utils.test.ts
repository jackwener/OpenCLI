import { describe, expect, it } from 'vitest';
import {
  canonicalizeProductUrl,
  dedupeSearchItems,
  normalizeProductId,
  normalizeSearchItem,
  sanitizeSearchItems,
} from './utils.js';

describe('normalizeProductId', () => {
  it('extracts product id from canonical path', () => {
    expect(normalizeProductId('https://www.coupang.com/vp/products/123456789')).toBe('123456789');
  });

  it('preserves numeric ids', () => {
    expect(normalizeProductId('987654321')).toBe('987654321');
  });
});

describe('canonicalizeProductUrl', () => {
  it('normalizes relative Coupang paths', () => {
    expect(canonicalizeProductUrl('/vp/products/123456789?itemId=1', '')).toBe(
      'https://www.coupang.com/vp/products/123456789'
    );
  });

  it('builds url from product id', () => {
    expect(canonicalizeProductUrl('', '123456789')).toBe('https://www.coupang.com/vp/products/123456789');
  });
});

describe('normalizeSearchItem', () => {
  it('maps raw fields into compare-ready shape', () => {
    const item = normalizeSearchItem({
      productId: '123456789',
      productName: '무선 마우스',
      salePrice: '29,900원',
      originalPrice: '39,900원',
      rating: '4.8',
      reviewCount: '1,234',
      sellerName: '쿠팡',
      badge: ['ROCKET', 'TOMORROW', '무료배송'],
      categoryName: 'PC',
      url: '/vp/products/123456789?itemId=1',
    }, 0);

    expect(item).toMatchObject({
      rank: 1,
      product_id: '123456789',
      title: '무선 마우스',
      price: 29900,
      original_price: 39900,
      rating: 4.8,
      review_count: 1234,
      rocket: '로켓배송',
      delivery_type: '무료배송',
      delivery_promise: '내일도착',
      seller: '쿠팡',
      category: 'PC',
      url: 'https://www.coupang.com/vp/products/123456789',
    });
  });
});

describe('sanitizeSearchItems', () => {
  it('drops duplicates and invalid rows', () => {
    const rows = [
      normalizeSearchItem({ productId: '1', productName: 'A', price: '1000', url: '/vp/products/1' }, 0),
      normalizeSearchItem({ productId: '1', productName: 'A', price: '1000', url: '/vp/products/1' }, 1),
      normalizeSearchItem({ productId: '', productName: '', price: '1000' }, 2),
      normalizeSearchItem({ productId: '2', productName: 'B', price: '2000', url: '/vp/products/2' }, 3),
    ];

    expect(dedupeSearchItems(rows)).toHaveLength(3);
    expect(sanitizeSearchItems(rows, 10)).toHaveLength(2);
    expect(sanitizeSearchItems(rows, 10).map(item => item.rank)).toEqual([1, 2]);
  });
});
