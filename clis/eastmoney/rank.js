// eastmoney rank — market mover list across common segments.
//
// Data source: push2.eastmoney.com/api/qt/clist/get (Tier 1 public JSON).
//   opencli eastmoney rank
//   opencli eastmoney rank --market cyb --sort turnover --limit 30

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const MARKETS = {
  'hs-a':   'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048', // 沪深 A
  'sh-a':   'm:1+t:2,m:1+t:23',                                   // 沪 A
  'sz-a':   'm:0+t:6,m:0+t:80',                                   // 深 A
  'bj-a':   'm:0+t:81+s:2048',                                    // 北证 A
  'cyb':    'm:0+t:80',                                           // 创业板
  'kcb':    'm:1+t:23',                                           // 科创板
  'hk':     'm:116+t:3,m:116+t:4,m:116+t:1,m:116+t:2',            // 港股
  'us':     'm:105,m:106,m:107',                                  // 美股
};

const SORTS = {
  change: { fid: 'f3',  order: 'desc' }, // 涨幅榜
  drop:   { fid: 'f3',  order: 'asc'  }, // 跌幅榜
  turnover:{ fid: 'f6', order: 'desc' }, // 成交额
  volume: { fid: 'f5',  order: 'desc' }, // 成交量
  amplitude:{ fid:'f7', order: 'desc' }, // 振幅
  rate:   { fid: 'f8',  order: 'desc' }, // 换手率
};

const FIELDS =
  'f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23';

cli({
  site: 'eastmoney',
  name: 'rank',
  description: '东财市场涨跌/成交排行（沪深/北证/创/科/港/美）',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'market', type: 'string', default: 'hs-a', help: '市场：hs-a / sh-a / sz-a / bj-a / cyb / kcb / hk / us' },
    { name: 'sort',   type: 'string', default: 'change', help: '排序：change / drop / turnover / volume / amplitude / rate' },
    { name: 'limit',  type: 'int',    default: 20,       help: '返回数量 (max 100)' },
  ],
  columns: ['rank', 'code', 'name', 'price', 'changePercent', 'change', 'turnover', 'volume', 'turnoverRate', 'peDynamic', 'marketCap'],
  func: async (_page, args) => {
    const market = String(args.market ?? 'hs-a').toLowerCase();
    const sortKey = String(args.sort ?? 'change').toLowerCase();
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));

    const fs = MARKETS[market];
    if (!fs) {
      throw new CliError('INVALID_ARGUMENT', `Unknown market "${market}". Valid: ${Object.keys(MARKETS).join(', ')}`);
    }
    const sort = SORTS[sortKey];
    if (!sort) {
      throw new CliError('INVALID_ARGUMENT', `Unknown sort "${sortKey}". Valid: ${Object.keys(SORTS).join(', ')}`);
    }

    const url = new URL('https://push2.eastmoney.com/api/qt/clist/get');
    url.searchParams.set('pn', '1');
    url.searchParams.set('pz', String(limit));
    url.searchParams.set('po', sort.order === 'desc' ? '1' : '0');
    url.searchParams.set('np', '1');
    url.searchParams.set('fltt', '2');
    url.searchParams.set('invt', '2');
    url.searchParams.set('fid', sort.fid);
    url.searchParams.set('fs', fs);
    url.searchParams.set('fields', FIELDS);
    url.searchParams.set('ut', 'bd1d9ddb04089700cf9c27f6f7426281');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `eastmoney rank failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
    if (diff.length === 0) {
      throw new CliError('NO_DATA', 'eastmoney returned no rank data', `market=${market} sort=${sortKey}`);
    }

    return diff.slice(0, limit).map((it, i) => ({
      rank: i + 1,
      code: it.f12,
      name: it.f14,
      price: it.f2,
      changePercent: it.f3,
      change: it.f4,
      turnover: it.f6,
      volume: it.f5,
      turnoverRate: it.f8,
      peDynamic: it.f9,
      marketCap: it.f20,
    }));
  },
});
