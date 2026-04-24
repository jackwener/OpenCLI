// eastmoney index-board — live quotes for key Chinese market indices.
//
// Data source: push2.eastmoney.com (Tier 1 public JSON, no auth).
//   opencli eastmoney index-board
//   opencli eastmoney index-board --group all

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const INDEX_GROUPS = {
  main: [
    ['1.000001', '上证指数'],
    ['0.399001', '深证成指'],
    ['0.399006', '创业板指'],
    ['1.000688', '科创50'],
    ['1.000300', '沪深300'],
    ['1.000905', '中证500'],
  ],
  hk: [
    ['100.HSI', '恒生指数'],
    ['100.HSCEI', '恒生国企'],
    ['100.HSTECH', '恒生科技'],
  ],
  us: [
    ['100.DJIA', '道琼斯'],
    ['100.SPX', '标普500'],
    ['100.NDX', '纳斯达克100'],
    ['100.IXIC', '纳斯达克综指'],
  ],
};

const FIELDS = 'f2,f3,f4,f12,f13,f14,f15,f16,f17,f18';

cli({
  site: 'eastmoney',
  name: 'index-board',
  description: '主要市场指数行情（A股 / 港股 / 美股）',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'group',
      type: 'string',
      default: 'main',
      help: '指数分组：main (A股主要), hk (港股), us (美股), all',
    },
  ],
  columns: ['code', 'name', 'price', 'changePercent', 'change', 'open', 'high', 'low', 'prevClose'],
  func: async (_page, args) => {
    const group = String(args.group ?? 'main').toLowerCase();
    /** @type {[string,string][]} */
    let entries;
    if (group === 'all') {
      entries = [...INDEX_GROUPS.main, ...INDEX_GROUPS.hk, ...INDEX_GROUPS.us];
    } else if (INDEX_GROUPS[group]) {
      entries = INDEX_GROUPS[group];
    } else {
      throw new CliError('INVALID_ARGUMENT', `Unknown group "${group}". Valid: main, hk, us, all`);
    }

    const secids = entries.map(([secid]) => secid).join(',');
    const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
    url.searchParams.set('secids', secids);
    url.searchParams.set('fltt', '2');
    url.searchParams.set('fields', FIELDS);
    url.searchParams.set('ut', 'bd1d9ddb04089700cf9c27f6f7426281');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `eastmoney index-board failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
    if (diff.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no index data');

    // Preserve the order defined in INDEX_GROUPS regardless of API ordering
    const byCode = new Map(diff.map((it) => [String(it.f12), it]));
    return entries
      .map(([secid, fallbackName]) => {
        const code = secid.split('.')[1];
        const it = byCode.get(code);
        if (!it) return null;
        return {
          code,
          name: it.f14 || fallbackName,
          price: it.f2,
          changePercent: it.f3,
          change: it.f4,
          open: it.f17,
          high: it.f15,
          low: it.f16,
          prevClose: it.f18,
        };
      })
      .filter(Boolean);
  },
});
