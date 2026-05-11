// eastmoney etf — ETF ranking by change / turnover.
//
//   opencli eastmoney etf
//   opencli eastmoney etf --sort change --limit 30

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const SORTS = {
  turnover: { fid: 'f6', order: 'desc' },
  change:   { fid: 'f3', order: 'desc' },
  drop:     { fid: 'f3', order: 'asc' },
  volume:   { fid: 'f5', order: 'desc' },
  rate:     { fid: 'f8', order: 'desc' },
};

cli({
  site: 'eastmoney',
  name: 'etf',
    access: 'read',
  description: 'ETF 列表按成交额/涨跌幅排行',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'sort', type: 'string', default: 'turnover', help: '排序：turnover / change / drop / volume / rate' },
    { name: 'limit', type: 'int',   default: 20,         help: '返回数量 (max 100)' },
  ],
  columns: ['rank', 'code', 'name', 'price', 'changePercent', 'change', 'turnover', 'volume', 'turnoverRate'],
  func: async (args) => {
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
    url.searchParams.set('fs', 'b:MK0021'); // 场内ETF
    url.searchParams.set('fields', 'f12,f14,f2,f3,f4,f5,f6,f8');
    url.searchParams.set('ut', 'bd1d9ddb04089700cf9c27f6f7426281');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `etf failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
    if (diff.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no ETF data');

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
    }));
  },
});
