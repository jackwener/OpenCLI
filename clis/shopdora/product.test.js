import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './product.js';

const {
  SHOPDORA_PRODUCT_URL,
  PRODUCT_SEARCH_API_PATTERN,
  PRODUCT_COLUMNS,
  SHOPEE_REGION_OPTIONS,
  normalizeShopeeUrl,
  getShopeeRegionOptionFromUrl,
  getShopeeImageRegionFromUrl,
  normalizeShopdoraImageUrl,
  buildResolveTargetSelectorScript,
  buildSetInputValueScript,
  parseInterceptedPayload,
  isShopdoraProductSearchUrl,
  isProductSearchEntry,
  isProductSearchItem,
  isProductSearchPayload,
  extractLatestProductSearchPayload,
  isSuccessfulSearchPayload,
  mapProductRecordToRow,
  runWithFocusedWindow,
  openShopdoraPage,
} = await import('./product.js').then((m) => m.__test__);

describe('shopdora product adapter', () => {
  const command = getRegistry().get('shopdora/product');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('shopdora');
    expect(command.name).toBe('product');
    expect(command.domain).toBe('www.shopdora.com');
    expect(command.strategy).toBe('cookie');
    expect(command.navigateBefore).toBe(false);
    expect(command.columns).toEqual(PRODUCT_COLUMNS);
    expect(SHOPEE_REGION_OPTIONS.find((item) => item.site === 'my')).toMatchObject({ title: '马来西亚' });
    expect(typeof command.func).toBe('function');
  });

  it('has shopeeUrl as a required positional arg', () => {
    const arg = command.args.find((item) => item.name === 'shopeeUrl');
    expect(arg).toBeDefined();
    expect(arg.required).toBe(true);
    expect(arg.positional).toBe(true);
  });

  it('normalizes shopee product urls', () => {
    expect(normalizeShopeeUrl('https://shopee.sg/item')).toBe('https://shopee.sg/item');
    expect(getShopeeRegionOptionFromUrl('https://shopee.com.my/product/1/2')).toMatchObject({ site: 'my', title: '马来西亚' });
    expect(() => normalizeShopeeUrl('')).toThrow('A Shopee product URL is required.');
    expect(() => normalizeShopeeUrl('not-a-url')).toThrow('shopdora product requires a valid absolute Shopee product URL.');
  });

  it('normalizes Shopdora image keys into Shopee image URLs', () => {
    expect(getShopeeImageRegionFromUrl('https://shopee.sg/product/1/2')).toBe('sg');
    expect(getShopeeImageRegionFromUrl('https://shopee.com.my/product/1/2')).toBe('my');
    expect(normalizeShopdoraImageUrl('sg-11134202-7rblu-lm8vu8pclp3ufe', 'https://shopee.sg/product/1/2')).toBe(
      'https://down-sg.img.susercontent.com/file/sg-11134202-7rblu-lm8vu8pclp3ufe',
    );
    expect(normalizeShopdoraImageUrl('sg-11134202-7rblu-lm8vu8pclp3ufe', 'https://shopee.com.my/product/1/2')).toBe(
      'https://down-my.img.susercontent.com/file/sg-11134202-7rblu-lm8vu8pclp3ufe',
    );
    expect(normalizeShopdoraImageUrl('https://down-sg.img.susercontent.com/file/sg-11134202-7rblu-lm8vu8pclp3ufe')).toBe(
      'https://down-sg.img.susercontent.com/file/sg-11134202-7rblu-lm8vu8pclp3ufe',
    );
    expect(normalizeShopdoraImageUrl('')).toBe('');
  });

  it('builds selectors and input scripts around the shopdora form', () => {
    expect(buildResolveTargetSelectorScript('product-id-input')).toContain('产品id');
    expect(buildResolveTargetSelectorScript('query-button')).toContain('查询');
    expect(buildResolveTargetSelectorScript('region-radio:my')).toContain('input[type="radio"]');
    expect(buildSetInputValueScript('[data-test="input"]', 'https://shopee.sg/item')).toContain('dispatchEvent(new Event(\'input\'');
  });

  it('finds the latest exact product search payload', () => {
    const hotClusterName = {
      url: 'https://www.shopdora.com/api/product/search/hotClusterName',
      body: JSON.stringify({ code: 'ok', data: { list: [{ clusterId: 1, name: 'shoe box' }] } }),
    };
    const first = { code: 'error', errMsg: 'bad' };
    const second = {
      url: 'https://www.shopdora.com/api/product/search',
      body: JSON.stringify({
        code: 'ok',
        data: { list: [{ itemId: '1' }] },
      }),
    };
    const third = {
      url: 'https://www.shopdora.com/api/product/search',
      body: JSON.stringify({
        code: 'ok',
        data: { list: [{ itemId: '2' }] },
      }),
    };
    expect(parseInterceptedPayload(second)).toEqual({ code: 'ok', data: { list: [{ itemId: '1' }] } });
    expect(isShopdoraProductSearchUrl('/api/product/search')).toBe(true);
    expect(isShopdoraProductSearchUrl('/api/product/search/hotClusterName')).toBe(false);
    expect(isProductSearchEntry(second)).toBe(true);
    expect(isProductSearchEntry(hotClusterName)).toBe(false);
    expect(isProductSearchEntry({ code: 'ok', data: { list: [{ clusterId: 1, name: 'shoe box' }] } })).toBe(false);
    expect(isProductSearchItem({ itemId: '1' })).toBe(true);
    expect(isProductSearchPayload(parseInterceptedPayload(second))).toBe(true);
    expect(isSuccessfulSearchPayload(first)).toBe(false);
    expect(isSuccessfulSearchPayload(parseInterceptedPayload(second))).toBe(true);
    expect(extractLatestProductSearchPayload([first, second, hotClusterName, third, hotClusterName])).toEqual({
      code: 'ok',
      data: { list: [{ itemId: '2' }] },
    });
  });

  it('maps a product search item into output columns', () => {
    const row = mapProductRecordToRow({
      itemId: '18892247931',
      shopId: '282945261',
      shopType: 0,
      catId: '100053',
      salesM: 434,
      salesGrowthRateM: 9638,
      salesAmountM: '619318000',
      salesAmountGrowthRateM: 8757,
      price: '1427000',
      avgPrice: '1482393',
      sellerSource: 1,
      ratingScore: 49,
      ratingNumberTotal: 1410,
      ratingNumberM: 71,
      ratingRateTotal: 3262,
      ratingRateM: 1635,
      name: 'HFA Men\'s Cotton Essential Casual Shorts',
      shelfTime: 20230823,
      brandId: '1206244',
      skuCnt: 5,
      likedCnt: 852,
      likedCntM: 17,
      skuAvgPrice: '1427000',
      avgSkuAvgPrice: '1482393',
      salesDay: 4,
      salesAmountDay: '5708000',
      hotClusterId: 75,
      hotClusterRank: 1,
      hotClusterRankChangeW: 0,
      cateRank: 1,
      sales7day: 10,
      shopStartTime: 20200708,
      status: 1,
      imageUrl: 'sg-11134207-7rbk0-lkrt3annwx2eb1',
      brand: 'HF Apparel',
      shopName: 'HFA SG',
      catePath: 'Men Clothes-Shorts',
      cateChPath: '男装-短裤',
      monitor: false,
      cateRankChangeD: 0,
      cateRankChangeW: 0,
      hotClusterName: 'Men\'s Casual Shorts',
      isCollect: false,
    }, 'https://shopee.sg/item', '');

    expect(row).toMatchObject({
      shopee_url: 'https://shopee.sg/item',
      item_id: '18892247931',
      shop_id: '282945261',
      name: 'HFA Men\'s Cotton Essential Casual Shorts',
      sales_m: 434,
      sales_7day: 10,
      image_url: 'https://down-sg.img.susercontent.com/file/sg-11134207-7rbk0-lkrt3annwx2eb1',
      hot_cluster_name: 'Men\'s Casual Shorts',
      cate_ch_path: '男装-短裤',
    });
  });

  it('maps image_url with the host for the Shopee URL region', () => {
    const row = mapProductRecordToRow({
      itemId: '18892247931',
      shopId: '282945261',
      imageUrl: 'sg-11134207-7rbk0-lkrt3annwx2eb1',
    }, 'https://shopee.com.my/product/282945261/18892247931', '');

    expect(row.image_url).toBe('https://down-my.img.susercontent.com/file/sg-11134207-7rbk0-lkrt3annwx2eb1');
  });

  it('navigates, triggers the search request, and returns mapped rows', async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    const newTab = vi.fn().mockResolvedValue('page-shopdora-product');
    const selectTab = vi.fn().mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockImplementation(async (script) => {
      const source = String(script ?? '');
      if (source.includes('.shopdoraLoginPage') && source.includes('.pageDetailLoginTitle')) {
        return { hasShopdoraLoginPage: false, hasPageDetailLoginTitle: false };
      }
      if (source.includes('const target = "product-id-input";')) {
        return {
          ok: true,
          selector: '[data-opencli-shopdora-product-target="product-id-input"]',
        };
      }
      if (source.includes('const target = "query-button";')) {
        return {
          ok: true,
          selector: '[data-opencli-shopdora-product-target="query-button"]',
        };
      }
      if (source.includes('const target = "region-radio:my";')) {
        return {
          ok: true,
          selector: '[data-opencli-shopdora-product-target="region-radio:my"]',
        };
      }
      if (source.includes('dispatchEvent(new Event(\'input\'')) {
        return { ok: true, value: 'https://shopee.com.my/product/282945261/18892247931' };
      }
      return { ok: true };
    });
    const installInterceptor = vi.fn().mockResolvedValue(undefined);
    const click = vi.fn().mockResolvedValue(undefined);
    const waitForCapture = vi.fn().mockResolvedValue(undefined);
    const getInterceptedRequests = vi.fn().mockResolvedValue([{
      code: 'ok',
      errMsg: '',
      data: {
        list: [{
          itemId: '18892247931',
          shopId: '282945261',
          shopType: 0,
          catId: '100053',
          salesM: 434,
          salesGrowthRateM: 9638,
          salesAmountM: '619318000',
          salesAmountGrowthRateM: 8757,
          price: '1427000',
          avgPrice: '1482393',
          sellerSource: 1,
          ratingScore: 49,
          ratingNumberTotal: 1410,
          ratingNumberM: 71,
          ratingRateTotal: 3262,
          ratingRateM: 1635,
          name: 'HFA Men\'s Cotton Essential Casual Shorts',
          shelfTime: 20230823,
          brandId: '1206244',
          skuCnt: 5,
          likedCnt: 852,
          likedCntM: 17,
          skuAvgPrice: '1427000',
          avgSkuAvgPrice: '1482393',
          salesDay: 4,
          salesAmountDay: '5708000',
          hotClusterId: 75,
          hotClusterRank: 1,
          hotClusterRankChangeW: 0,
          cateRank: 1,
          sales7day: 10,
          shopStartTime: 20200708,
          status: 1,
          imageUrl: 'sg-11134207-7rbk0-lkrt3annwx2eb1',
          brand: 'HF Apparel',
          shopName: 'HFA SG',
          catePath: 'Men Clothes-Shorts',
          cateChPath: '男装-短裤',
          monitor: false,
          cateRankChangeD: 0,
          cateRankChangeW: 0,
          hotClusterName: 'Men\'s Casual Shorts',
          isCollect: false,
        }],
      },
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

    const result = await command.func(page, {
      shopeeUrl: 'https://shopee.com.my/product/282945261/18892247931',
    });

    expect(newTab).toHaveBeenCalledWith(SHOPDORA_PRODUCT_URL);
    expect(selectTab).toHaveBeenCalledWith('page-shopdora-product');
    expect(goto).not.toHaveBeenCalled();
    expect(installInterceptor).toHaveBeenCalledWith(PRODUCT_SEARCH_API_PATTERN);
    expect(click).toHaveBeenCalledWith('[data-opencli-shopdora-product-target="region-radio:my"]');
    expect(click).toHaveBeenCalledWith('[data-opencli-shopdora-product-target="query-button"]');
    expect(waitForCapture).toHaveBeenCalledWith(15);
    expect(result).toEqual([expect.objectContaining({
      shopee_url: 'https://shopee.com.my/product/282945261/18892247931',
      item_id: '18892247931',
      shop_name: 'HFA SG',
      shopdora_login_message: '',
    })]);
  });

  it('falls back to current-tab navigation when newTab is unavailable', async () => {
    const goto = vi.fn().mockResolvedValue(undefined);
    await expect(openShopdoraPage({ goto }, SHOPDORA_PRODUCT_URL)).resolves.toBeNull();
    expect(goto).toHaveBeenCalledWith(SHOPDORA_PRODUCT_URL, { waitUntil: 'load' });
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
