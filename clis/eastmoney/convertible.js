// eastmoney convertible — on-market convertible bond listing.
//
//   opencli eastmoney convertible
//   opencli eastmoney convertible --sort premium --limit 30

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const SORTS = {
  change:   { fid: 'f3',   order: 'desc' },
  drop:     { fid: 'f3',   order: 'asc' },
  turnover: { fid: 'f6',   order: 'desc' },
  price:    { fid: 'f2',   order: 'desc' },
  premium:  { fid: 'f237', order: 'desc' }, // 转股溢价率
  value:    { fid: 'f236', order: 'desc' }, // 转股价值
  ytm:      { fid: 'f239', order: 'desc' }, // 到期收益率
};

cli({
  site: 'eastmoney',
  name: 'convertible',
  description: '可转债行情列表（默认按成交额排序）',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'sort',  type: 'string', default: 'turnover', help: '排序：turnover / change / drop / price / premium' },
    { name: 'limit', type: 'int',    default: 20,         help: '返回数量 (max 100)' },
  ],
  columns: ['rank', 'bondCode', 'bondName', 'bondPrice', 'bondChangePct', 'stockCode', 'stockName', 'stockPrice', 'stockChangePct', 'convPrice', 'convValue', 'convPremiumPct', 'remainingYears', 'ytm', 'listDate'],
  func: async (_page, args) => {
    const sortKey = String(args.sort ?? 'turnover').toLowerCase();
    const sort = SORTS[sortKey];
    if (!sort) throw new CliError('INVALID_ARGUMENT', `Unknown sort "${sortKey}". Valid: ${Object.keys(SORTS).join(', ')}`);
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));

    const url = new URL('https://push2.eastmoney.com/api/qt/clist/get');
    url.searchParams.set('pn', '1');
    url.searchParams.set('pz', String(limit));
    url.searchParams.set('po', sort.order === 'desc' ? '1' : '0');
    url.searchParams.set('np', '1');
    url.searchParams.set('fltt', '2');
    url.searchParams.set('invt', '2');
    url.searchParams.set('fid', sort.fid);
    url.searchParams.set('fs', 'b:MK0354');
    url.searchParams.set('fields', 'f12,f14,f2,f3,f6,f229,f230,f232,f234,f235,f236,f237,f238,f239,f243');
    url.searchParams.set('ut', 'bd1d9ddb04089700cf9c27f6f7426281');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `convertible failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
    if (diff.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no convertible data');

    return diff.slice(0, limit).map((it, i) => ({
      rank: i + 1,
      bondCode: it.f12,
      bondName: it.f14,
      bondPrice: it.f2,
      bondChangePct: it.f3,
      stockCode: it.f232,
      stockName: it.f234,
      stockPrice: it.f229,
      stockChangePct: it.f230,
      convPrice: it.f235,
      convValue: it.f236,
      convPremiumPct: it.f237,
      remainingYears: it.f238,
      ytm: it.f239,
      listDate: String(it.f243 ?? ''),
    }));
  },
});
