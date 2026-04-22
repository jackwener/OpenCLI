import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import './search.js';
import { __test__ } from './search.js';

describe('shopee search adapter registration', () => {
  const command = getRegistry().get('shopee/search');

  it('registers the command with the expected public shape', () => {
    expect(command).toBeDefined();
    expect(command!.site).toBe('shopee');
    expect(command!.name).toBe('search');
    expect(command!.domain).toBe('shopee.com.my');
    expect(command!.strategy).toBe('cookie');
    expect(command!.navigateBefore).toBe(false);
    expect(command!.columns).toEqual(['rank', 'product_url', 'title']);
  });

  it('declares query, sortby, limit, and origin args', () => {
    expect(command!.args).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'query', positional: true, required: true }),
      expect.objectContaining({ name: 'sortby', default: 'top-sale', choices: ['top-sale', 'latest', 'relevance'] }),
      expect.objectContaining({ name: 'limit', type: 'int', default: 20 }),
      expect.objectContaining({ name: 'origin', default: 'https://shopee.com.my' }),
    ]));
  });
});

describe('shopee search URL and sort helpers', () => {
  it('maps supported sortby values to Shopee URL params', () => {
    expect(__test__.normalizeSortBy(undefined)).toBe('top-sale');
    expect(__test__.SORT_BY_PARAM[__test__.normalizeSortBy('top-sale')]).toBe('sales');
    expect(__test__.SORT_BY_PARAM[__test__.normalizeSortBy('latest')]).toBe('ctime');
    expect(__test__.SORT_BY_PARAM[__test__.normalizeSortBy('relevance')]).toBe('relevancy');
  });

  it('rejects unsupported sortby values', () => {
    expect(() => __test__.normalizeSortBy('price-asc')).toThrow('Unsupported Shopee sortby');
  });

  it('builds a Shopee search URL for any Shopee origin', () => {
    expect(__test__.buildSearchUrl('camera', 'top-sale', 'https://shopee.com.my')).toBe(
      'https://shopee.com.my/search?keyword=camera&page=0&sortBy=sales',
    );
    expect(__test__.buildSearchUrl('kids camera', 'latest', 'shopee.sg')).toBe(
      'https://shopee.sg/search?keyword=kids+camera&page=0&sortBy=ctime',
    );
  });

  it('normalizes and validates Shopee origins', () => {
    expect(__test__.normalizeOrigin('shopee.com.my')).toBe('https://shopee.com.my');
    expect(__test__.normalizeOrigin('https://shopee.sg/search?keyword=x')).toBe('https://shopee.sg');
    expect(() => __test__.normalizeOrigin('https://example.com')).toThrow('Shopee search origin');
  });
});

describe('shopee product URL normalization', () => {
  const sourceUrl = 'https://shopee.com.my/search?keyword=camera&page=0&sortBy=sales';

  it('canonicalizes slug product URLs and strips tracking params', () => {
    expect(
      __test__.canonicalizeProductUrl(
        '/Kids-Mini-Camera-i.1385679855.27077262756?extraParams=1&sp_atk=abc#hash',
        sourceUrl,
      ),
    ).toBe('https://shopee.com.my/Kids-Mini-Camera-i.1385679855.27077262756');
  });

  it('canonicalizes product path URLs', () => {
    expect(
      __test__.canonicalizeProductUrl('/product/1385679855/27077262756?foo=bar', sourceUrl),
    ).toBe('https://shopee.com.my/product/1385679855/27077262756');
  });

  it('rejects non-product and non-Shopee URLs', () => {
    expect(
      __test__.canonicalizeProductUrl(
        '/find_similar_products?catid=100635&itemid=27077262756&shopid=1385679855',
        sourceUrl,
      ),
    ).toBe('');
    expect(__test__.canonicalizeProductUrl('https://example.com/product/1/2', sourceUrl)).toBe('');
  });
});

describe('shopee search row normalization', () => {
  it('dedupes products and ranks normalized rows', () => {
    const rows = __test__.normalizeSearchRows({
      href: 'https://shopee.com.my/search?keyword=camera',
      items: [
        {
          href: '/Kids-Mini-Camera-i.1385679855.27077262756?sp_atk=1',
          title: 'Kids Mini Camera',
        },
        {
          href: '/Kids-Mini-Camera-i.1385679855.27077262756?sp_atk=2',
          title: 'Duplicate',
        },
        {
          href: '/product/111/222?x=1',
          title: 'Second Camera',
        },
      ],
    }, 10);

    expect(rows).toEqual([
      {
        rank: 1,
        product_url: 'https://shopee.com.my/Kids-Mini-Camera-i.1385679855.27077262756',
        title: 'Kids Mini Camera',
      },
      {
        rank: 2,
        product_url: 'https://shopee.com.my/product/111/222',
        title: 'Second Camera',
      },
    ]);
  });
});

describe('shopee search command execution', () => {
  it('navigates, extracts, and returns product links', async () => {
    const command = getRegistry().get('shopee/search');
    const page = {
      goto: vi.fn<NonNullable<IPage['goto']>>().mockResolvedValue(undefined),
      wait: vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined),
      autoScroll: vi.fn<NonNullable<IPage['autoScroll']>>().mockResolvedValue(undefined),
      evaluate: vi.fn<NonNullable<IPage['evaluate']>>().mockResolvedValue({
        href: 'https://shopee.com.my/search?keyword=camera&page=0&sortBy=sales',
        loginRequired: false,
        items: [
          {
            href: '/Kids-Mini-Camera-i.1385679855.27077262756?extraParams=1',
            title: 'Kids Mini Camera',
          },
        ],
      }),
    } as unknown as IPage;

    await expect(command!.func!(page, { query: 'camera', sortby: 'top-sale', limit: 20 })).resolves.toEqual([
      {
        rank: 1,
        product_url: 'https://shopee.com.my/Kids-Mini-Camera-i.1385679855.27077262756',
        title: 'Kids Mini Camera',
      },
    ]);

    expect(page.goto).toHaveBeenCalledWith(
      'https://shopee.com.my/search?keyword=camera&page=0&sortBy=sales',
      { waitUntil: 'load' },
    );
    expect(page.wait).toHaveBeenCalledWith({
      selector: __test__.SEARCH_ITEM_SELECTOR,
      timeout: 8,
    });
    expect(page.autoScroll).toHaveBeenCalledWith({ times: 3, delayMs: 900 });
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining('shopee-search-item-result__item'));
  });

  it('raises an auth error when the page reports logged-out state', async () => {
    const command = getRegistry().get('shopee/search');
    const page = {
      goto: vi.fn<NonNullable<IPage['goto']>>().mockResolvedValue(undefined),
      wait: vi.fn<NonNullable<IPage['wait']>>().mockResolvedValue(undefined),
      autoScroll: vi.fn<NonNullable<IPage['autoScroll']>>().mockResolvedValue(undefined),
      evaluate: vi.fn<NonNullable<IPage['evaluate']>>().mockResolvedValue({
        href: 'https://shopee.com.my/search?keyword=camera&page=0&sortBy=sales',
        loginRequired: true,
        items: [],
      }),
    } as unknown as IPage;

    await expect(command!.func!(page, { query: 'camera' })).rejects.toThrow('Shopee login required');
  });
});
