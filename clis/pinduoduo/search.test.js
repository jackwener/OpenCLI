import { describe, expect, it, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './search.js';
import './search.js';

const SEARCH_URL = 'https://mobile.yangkeduo.com/search_result.html';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

/**
 * Runs the adapter's real page-side source inside a jsdom window, so the extraction code
 * itself is exercised instead of a mocked return value.
 */
function pageWithRawData(rawData) {
  const dom = new JSDOM('<!doctype html><html><body><div id="main"></div></body></html>', {
    url: SEARCH_URL,
    runScripts: 'outside-only',
  });
  dom.window.rawData = rawData;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async source => await dom.window.eval(source)),
  };
}

/** data 挂在 store.data，initialState 是 store 的兄弟字段（与真实页面结构一致）。 */
function storeWith(dataOverrides, storeExtras = {}) {
  return { stores: { store: { ...storeExtras, data: dataOverrides } } };
}

describe('pinduoduo search helpers', () => {
  it('clamps limit into the SSR first page', () => {
    expect(__test__.clampInt(100, 10, 1, 20)).toBe(20);
    expect(__test__.clampInt(0, 10, 1, 20)).toBe(1);
    expect(__test__.clampInt('7', 10, 1, 20)).toBe(7);
    expect(__test__.clampInt(7.9, 10, 1, 20)).toBe(7);
  });

  it('falls back for unusable limit values', () => {
    expect(__test__.clampInt(undefined, 10, 1, 20)).toBe(10);
    expect(__test__.clampInt('not-a-number', 10, 1, 20)).toBe(10);
  });

  it('trims the query and rejects an empty one', () => {
    expect(__test__.requireQuery('  手机壳 ')).toBe('手机壳');
    expect(() => __test__.requireQuery('   ')).toThrow();
    expect(() => __test__.requireQuery(undefined)).toThrow();
  });

  it('parses cents into yuan and keeps unknown prices empty', () => {
    expect(__test__.toYuan(5800)).toBe('58.00');
    expect(__test__.toYuan(0)).toBe('0.00');
    expect(__test__.toYuan(null)).toBe('');
    expect(__test__.toYuan(undefined)).toBe('');
    expect(__test__.toYuan('')).toBe('');
    expect(__test__.toYuan('not-a-number')).toBe('');
  });
});

describe('pinduoduo search page extraction', () => {
  const command = getRegistry().get('pinduoduo/search');

  it('reads the SSR list in the page and maps displayed price apart from group price', async () => {
    const items = [
      {
        goodsID: 597606231941,
        goodsName: '【全新18】图拉斯手机壳D1',
        price: 5800, // 拼单价 58.00，单位分
        priceType: 2,
        priceInfo: '44.08', // 页面展示的券后价
        pricePrefixInfo: '券后',
        salesTip: '全店总售496万+件',
        tagList: [{ text: '正品险' }, { text: '顺丰包邮' }],
      },
      {
        goodsID: 968918296375,
        goodsName: '【品胜】液态硅胶手机壳',
        price: 4900,
        priceType: 0,
        priceInfo: '49',
        salesTip: '本店已拼117万+件',
        tagList: [],
      },
    ];
    const page = pageWithRawData(storeWith({ hasLogin: true, ssrListData: { list: items } }));

    const rows = await command.func(page, { query: '手机壳', limit: 2 });

    expect(page.goto).toHaveBeenCalledWith(`${SEARCH_URL}?search_key=${encodeURIComponent('手机壳')}`);
    // 传给 evaluate 的是页面源码而不是数据：上面的行只能由那段源码在窗口里跑出来。
    expect(typeof page.evaluate.mock.calls[0][0]).toBe('string');
    expect(page.evaluate.mock.calls[0][0]).toContain('rawData');
    expect(rows).toEqual([
      {
        rank: 1,
        title: '【全新18】图拉斯手机壳D1',
        price: '44.08',
        price_label: '券后',
        group_price: '58.00',
        sales: '全店总售496万+件',
        tags: '正品险 / 顺丰包邮',
        goods_id: '597606231941',
        url: 'https://mobile.yangkeduo.com/goods.html?goods_id=597606231941',
      },
      {
        rank: 2,
        title: '【品胜】液态硅胶手机壳',
        price: '49',
        price_label: '',
        group_price: '49.00',
        sales: '本店已拼117万+件',
        tags: '',
        goods_id: '968918296375',
        url: 'https://mobile.yangkeduo.com/goods.html?goods_id=968918296375',
      },
    ]);
  });

  it('leaves prices empty instead of turning unknown values into 0.00', async () => {
    const page = pageWithRawData(
      storeWith({
        hasLogin: true,
        ssrListData: {
          list: [{ goodsID: 1, goodsName: '无价商品', price: null, priceInfo: null, salesTip: null }],
        },
      }),
    );

    const [row] = await command.func(page, { query: '无价', limit: 1 });

    expect(row.price).toBe('');
    expect(row.group_price).toBe('');
    expect(row.sales).toBe('');
  });

  it('falls back to initialState.list when the SSR list is empty', async () => {
    const page = pageWithRawData(
      storeWith(
        { hasLogin: true, ssrListData: { list: [] } },
        { initialState: { list: [{ goodsID: 42, goodsName: '回退商品', price: 100, priceInfo: '1' }] } },
      ),
    );

    const [row] = await command.func(page, { query: '回退', limit: 1 });

    expect(row.goods_id).toBe('42');
    expect(row.group_price).toBe('1.00');
  });

  it('returns the login error without waiting for the list', async () => {
    const page = pageWithRawData(storeWith({ hasLogin: false, ssrListData: { list: [] } }));
    const startedAt = Date.now();

    await expect(command.func(page, { query: '手机壳', limit: 1 })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('reports EMPTY_RESULT when the page never exposes rawData', async () => {
    // 该分支下页面侧源码会轮询 40 次，这里只验证适配器控制流。
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
    };

    await expect(command.func(page, { query: '手机壳', limit: 1 })).rejects.toMatchObject({
      code: 'EMPTY_RESULT',
    });
  });
});
