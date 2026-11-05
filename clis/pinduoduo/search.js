/**
 * 拼多多商品搜索 —— 读 H5 搜索页的服务端渲染数据。
 *
 * 为什么是 window.rawData 而不是抓 DOM 或重放接口：
 *  - 搜索页 SSR，结果内联在 window.rawData.stores.store.data.ssrListData.list；
 *  - 站点 DOM 类名按构建 hash 化（_1iyBHIt5 之类），卡片里也没有标题文本；
 *  - /proxy/api/search 只在客户端交互（排序/翻页）时触发，body 带运行期风控字段，
 *    重放不稳定，交给页面自己发。
 *
 * 字段语义（实测，2026-11-05，见 PR 讨论）：
 *  - priceInfo 是页面展示的那个价（pricePrefixInfo 为「券后」时就是券后价）；
 *  - price 是整数「分」，priceType=0 时 priceInfo == price/100，priceType=2（有券）时
 *    price 高于 priceInfo；与商品页 minGroupPrice 交叉核对一致，所以它是券前拼单价；
 *  - 列表项没有 normalPrice / marketPrice / linePrice，拿不到划线价。
 *
 * 已知边界：SSR 列表固定首屏 20 条，滚动加载的后续数据不写回该 store，因此 limit 上限 20。
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';

const SEARCH_URL = 'https://mobile.yangkeduo.com/search_result.html';
const SSR_PAGE_SIZE = 20;

function clampInt(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

function requireQuery(value) {
  const query = String(value ?? '').trim();
  if (!query) throw new ArgumentError('query 不能为空', 'opencli pinduoduo search 手机壳');
  return query;
}

/** 分 → 元。未知价格保持空字符串，不能变成 "0.00"。 */
function toYuan(fen) {
  if (fen === null || fen === undefined || fen === '') return '';
  const n = Number(fen);
  return Number.isFinite(n) ? (n / 100).toFixed(2) : '';
}

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

cli({
  site: 'pinduoduo',
  name: 'search',
  access: 'read',
  description: '拼多多商品搜索（H5 首屏，需要登录态）',
  domain: 'mobile.yangkeduo.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', positional: true, required: true, help: '搜索关键词' },
    { name: 'limit', type: 'int', default: 10, help: `返回条数 (1-${SSR_PAGE_SIZE}，首屏上限)` },
  ],
  columns: ['rank', 'title', 'price', 'priceLabel', 'groupPrice', 'sales', 'tags', 'goodsId', 'url'],
  func: async (page, kwargs) => {
    const query = requireQuery(kwargs.query);
    const limit = clampInt(kwargs.limit, 10, 1, SSR_PAGE_SIZE);

    await page.goto(`${SEARCH_URL}?search_key=${encodeURIComponent(query)}`);
    await page.wait(3);

    const state = await page.evaluate(`(async () => {
      const read = () => {
        const store = window.rawData && window.rawData.stores && window.rawData.stores.store;
        if (!store || !store.data) return null;
        const ssr = store.data.ssrListData;
        const ssrList = ssr && Array.isArray(ssr.list) && ssr.list.length ? ssr.list : null;
        const init = store.initialState;
        const initList = init && Array.isArray(init.list) ? init.list : [];
        return { hasLogin: store.data.hasLogin, list: ssrList || initList };
      };
      for (let i = 0; i < 40; i++) {
        const s = read();
        // 明确未登录时不再等列表，直接交给调用方报登录错误。
        if (s && s.hasLogin === false) return s;
        if (s && s.list.length) return s;
        await new Promise(r => setTimeout(r, 500));
      }
      return read();
    })()`);

    if (!state) {
      throw new EmptyResultError('pinduoduo search', '搜索页没渲染出 window.rawData，可能被风控或页面结构已变');
    }
    if (state.hasLogin === false) {
      throw new AuthRequiredError(
        'mobile.yangkeduo.com',
        '拼多多搜索需要登录态',
        '在这个浏览器打开 https://mobile.yangkeduo.com 登录一次，然后重跑',
      );
    }
    if (!state.list.length) {
      throw new EmptyResultError(`pinduoduo search "${query}"`, '没搜到结果，或首屏数据还没渲染完');
    }

    return state.list.slice(0, limit).map((item, i) => ({
      rank: i + 1,
      title: clean(item.goodsName),
      price: clean(item.priceInfo),
      priceLabel: clean(item.pricePrefixInfo),
      groupPrice: toYuan(item.price),
      sales: clean(item.salesTip),
      tags: (item.tagList || []).map(t => clean(t.text)).filter(Boolean).join(' / '),
      goodsId: String(item.goodsID ?? ''),
      url: item.goodsID ? `https://mobile.yangkeduo.com/goods.html?goods_id=${item.goodsID}` : '',
    }));
  },
});

export const __test__ = { clampInt, requireQuery, toYuan };
