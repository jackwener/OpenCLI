import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';

const {
  SHOPDORA_HOT_PRODUCT_URL,
  PRODUCT_SEARCH_API_PATTERN,
  OUTPUT_COLUMNS,
  normalizeKeyword,
  normalizeRegion,
  getRegionOption,
  buildShopeeProductUrl,
  buildResolveTargetSelectorScript,
  buildSetInputValueScript,
  parseInterceptedPayload,
  isProductSearchEntry,
  isShopdoraProductSearchUrl,
  isSuccessfulSearchPayload,
  extractLatestProductSearchPayload,
  waitForProductSearchPayload,
  extractSearchResult,
  mapSearchResultWithUrls,
  runWithFocusedWindow,
  openShopdoraPage,
} = await import('./search.js').then((m) => m.__test__);

describe('shopdora search adapter', () => {
  const command = getRegistry().get('shopdora/search');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('shopdora');
    expect(command.name).toBe('search');
    expect(command.domain).toBe('www.shopdora.com');
    expect(command.strategy).toBe('cookie');
    expect(command.navigateBefore).toBe(false);
    expect(command.columns).toEqual(OUTPUT_COLUMNS);
    expect(typeof command.func).toBe('function');
  });

  it('has keyword as a required positional arg', () => {
    const arg = command.args.find((item) => item.name === 'keyword');
    expect(arg).toBeDefined();
    expect(arg.required).toBe(true);
    expect(arg.positional).toBe(true);
    expect(command.args.find((item) => item.name === 'region')).toMatchObject({ default: 'sg' });
  });

  it('normalizes keyword and region input', () => {
    expect(normalizeKeyword('  shoes  ')).toBe('shoes');
    expect(() => normalizeKeyword('')).toThrow('A Shopdora search keyword is required.');
    expect(normalizeRegion('my')).toBe('my');
    expect(normalizeRegion('mc')).toBe('mx');
    expect(getRegionOption('th')).toMatchObject({ host: 'shopee.co.th', title: '泰国' });
    expect(() => normalizeRegion('xx')).toThrow('Unsupported Shopdora region');
  });

  it('builds selectors and input scripts around the hot-product form', () => {
    expect(buildResolveTargetSelectorScript('keyword-input')).toContain('搜索热门产品');
    expect(buildResolveTargetSelectorScript('query-button')).toContain('查询');
    expect(buildResolveTargetSelectorScript('region-select-trigger')).toContain('regionOptions');
    expect(buildResolveTargetSelectorScript('region-radio:my')).toContain('input[type="radio"]');
    expect(buildResolveTargetSelectorScript('region-option:马来西亚')).toContain('region-option:');
    expect(buildSetInputValueScript('[data-test="input"]', 'shoe')).toContain('dispatchEvent(new Event(\'input\'');
  });

  it('finds the latest valid product search payload', () => {
    const hotClusterName = {
      url: 'https://www.shopdora.com/api/product/search/hotClusterName',
      body: JSON.stringify({ code: 'ok', data: { list: [{ clusterId: 1 }] } }),
    };
    const first = {
      url: 'https://www.shopdora.com/api/product/search',
      body: JSON.stringify({ code: 'error', errMsg: 'bad' }),
    };
    const second = {
      url: 'https://www.shopdora.com/api/product/search',
      body: JSON.stringify({ code: 'ok', data: { list: [{ itemId: '1' }] } }),
    };
    const third = {
      url: 'https://www.shopdora.com/api/product/search',
      body: JSON.stringify({ code: 'ok', data: { list: [{ itemId: '2' }] } }),
    };
    expect(parseInterceptedPayload(second)).toEqual({ code: 'ok', data: { list: [{ itemId: '1' }] } });
    expect(isShopdoraProductSearchUrl('/api/product/search')).toBe(true);
    expect(isShopdoraProductSearchUrl('/api/product/search/hotClusterName')).toBe(false);
    expect(isProductSearchEntry(second)).toBe(true);
    expect(isProductSearchEntry(hotClusterName)).toBe(false);
    expect(isProductSearchEntry({ body: JSON.stringify({ code: 'ok', data: { list: [] } }) })).toBe(false);
    expect(isProductSearchEntry({ url: 'https://www.shopdora.com/api/comment/list' })).toBe(false);
    expect(isSuccessfulSearchPayload(parseInterceptedPayload(first))).toBe(false);
    expect(isSuccessfulSearchPayload(parseInterceptedPayload(second))).toBe(true);
    expect(extractLatestProductSearchPayload([hotClusterName, first, second, third, hotClusterName])).toEqual({
      code: 'ok',
      data: { list: [{ itemId: '2' }] },
    });
  });

  it('extracts the search result from data.list', () => {
    expect(extractSearchResult({ code: 'ok', data: { list: [{ itemId: '1' }] } })).toEqual([{ itemId: '1' }]);
    expect(extractSearchResult({ code: 'ok', data: { totalCount: 0 } })).toEqual({ totalCount: 0 });
    expect(buildShopeeProductUrl({ shopId: '282945261', itemId: '18892247931' }, 'my')).toBe('https://shopee.com.my/product/282945261/18892247931');
    expect(mapSearchResultWithUrls([{ shopId: '282945261', itemId: '18892247931' }], 'tw')).toEqual([{
      shopId: '282945261',
      itemId: '18892247931',
      url: 'https://shopee.tw/product/282945261/18892247931',
    }]);
  });

  it('waits for delayed product/search captures', async () => {
    const rows = [{ itemId: 'delayed-1' }];
    const page = {
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue([]),
      getInterceptedRequests: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          url: 'https://www.shopdora.com/api/product/search',
          body: JSON.stringify({ code: 'ok', data: { list: rows } }),
        }]),
    };

    await expect(waitForProductSearchPayload(page, 2)).resolves.toMatchObject({
      payload: { code: 'ok', data: { list: rows } },
    });
    expect(page.wait).toHaveBeenCalledWith(0.5);
  });

  it('navigates, triggers the search request, and returns raw search rows', async () => {
    const rows = [
      { itemId: '18892247931', shopId: '282945261', name: 'shoe laces' },
    ];
    const goto = vi.fn().mockResolvedValue(undefined);
    const newTab = vi.fn().mockResolvedValue('page-shopdora-hot-product');
    const selectTab = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('.shopdoraLoginPage') && source.includes('.pageDetailLoginTitle')) {
        return { hasShopdoraLoginPage: false, hasPageDetailLoginTitle: false };
      }
      if (source.includes('const target = "keyword-input";')) {
        return {
          ok: true,
          selector: '[data-opencli-shopdora-search-target="keyword-input"]',
        };
      }
      if (source.includes('const target = "query-button";')) {
        return {
          ok: true,
          selector: '[data-opencli-shopdora-search-target="query-button"]',
        };
      }
      if (source.includes('const target = "region-radio:my";')) {
        return {
          ok: true,
          selector: '[data-opencli-shopdora-search-target="region-radio:my"]',
        };
      }
      if (source.includes('dispatchEvent(new Event(\'input\'')) {
        return { ok: true, value: 'shoe' };
      }
      return { ok: true };
    });
    const installInterceptor = vi.fn().mockResolvedValue(undefined);
    const click = vi.fn().mockResolvedValue(undefined);
    const waitForCapture = vi.fn().mockResolvedValue(undefined);
    const getInterceptedRequests = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
      url: 'https://www.shopdora.com/api/product/search',
      body: JSON.stringify({
        code: 'ok',
        errMsg: '',
        data: { list: rows },
      }),
    }]);

    const page = {
      goto,
      newTab,
      selectTab,
      wait,
      evaluate,
      installInterceptor,
      click,
      waitForCapture,
      getInterceptedRequests,
    };

    const result = await command.func(page, { keyword: 'shoe', region: 'my' });

    expect(newTab).toHaveBeenCalledWith(SHOPDORA_HOT_PRODUCT_URL);
    expect(selectTab).toHaveBeenCalledWith('page-shopdora-hot-product');
    expect(goto).not.toHaveBeenCalled();
    expect(installInterceptor).toHaveBeenCalledWith(PRODUCT_SEARCH_API_PATTERN);
    expect(click).toHaveBeenCalledWith('[data-opencli-shopdora-search-target="region-radio:my"]');
    expect(click).toHaveBeenCalledWith('[data-opencli-shopdora-search-target="query-button"]');
    expect(waitForCapture).toHaveBeenCalledWith(15);
    expect(result).toEqual([{
      ...rows[0],
      url: 'https://shopee.com.my/product/282945261/18892247931',
    }]);
  });

  it('falls back to current-tab navigation when newTab is unavailable', async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    await expect(openShopdoraPage({ goto }, SHOPDORA_HOT_PRODUCT_URL)).resolves.toBeNull();
    expect(goto).toHaveBeenCalledWith(SHOPDORA_HOT_PRODUCT_URL, { waitUntil: 'load' });
  });

  it('temporarily forces focused automation windows for newTab flows', async () => {
    delete process.env.OPENCLI_WINDOW_FOCUSED;
    await expect(runWithFocusedWindow(async () => {
      expect(process.env.OPENCLI_WINDOW_FOCUSED).toBe('1');
      return 'ok';
    })).resolves.toBe('ok');
    expect(process.env.OPENCLI_WINDOW_FOCUSED).toBeUndefined();
  });
});
