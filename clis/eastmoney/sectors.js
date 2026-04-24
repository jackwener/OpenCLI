// eastmoney sectors — industry / concept / region sector board ranking.
//
//   opencli eastmoney sectors
//   opencli eastmoney sectors --type concept --sort money-flow --limit 30

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const SECTOR_TYPES = {
  industry: 'm:90+t:2',
  concept:  'm:90+t:3',
  region:   'm:90+t:1',
};

const SORTS = {
  change: { fid: 'f3', order: 'desc' },
  drop:   { fid: 'f3', order: 'asc' },
  'money-flow': { fid: 'f62', order: 'desc' },
  'out-flow':   { fid: 'f62', order: 'asc' },
  turnover: { fid: 'f6', order: 'desc' },
};

cli({
  site: 'eastmoney',
  name: 'sectors',
  description: '板块排行（行业/概念/地域）按涨跌幅、主力资金或成交额排序',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'type', type: 'string', default: 'industry', help: '板块类型：industry / concept / region' },
    { name: 'sort', type: 'string', default: 'change',   help: '排序：change / drop / money-flow / out-flow / turnover' },
    { name: 'limit', type: 'int',   default: 20,         help: '返回数量 (max 100)' },
  ],
  columns: ['rank', 'code', 'name', 'price', 'changePercent', 'mainNet', 'leadStock', 'leadChangePercent', 'upCount', 'downCount'],
  func: async (_page, args) => {
    const typeKey = String(args.type ?? 'industry').toLowerCase();
    const fs = SECTOR_TYPES[typeKey];
    if (!fs) throw new CliError('INVALID_ARGUMENT', `Unknown sector type "${typeKey}". Valid: ${Object.keys(SECTOR_TYPES).join(', ')}`);
    const sortKey = String(args.sort ?? 'change').toLowerCase();
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
    url.searchParams.set('fs', fs);
    url.searchParams.set('fields', 'f12,f14,f2,f3,f62,f104,f105,f128,f136,f140,f141');
    url.searchParams.set('ut', 'b2884a393a59ad64002292a3e90d46a5');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `sectors failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
    if (diff.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no sector data');

    return diff.slice(0, limit).map((it, i) => ({
      rank: i + 1,
      code: it.f12,
      name: it.f14,
      price: it.f2,
      changePercent: it.f3,
      mainNet: it.f62,
      leadStock: it.f128,
      leadChangePercent: it.f136,
      upCount: it.f104,
      downCount: it.f105,
    }));
  },
});
