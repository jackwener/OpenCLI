// eastmoney money-flow — main-force net inflow ranking (沪深A今日/5日/10日).
//
//   opencli eastmoney money-flow
//   opencli eastmoney money-flow --range 5d --limit 30

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const A_MARKET = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';

// (main, super, big, medium, small) net inflow amount fields
const RANGES = {
  today: { fid: 'f62', fields: { net: 'f62', netPct: 'f184', super: 'f66', big: 'f72', medium: 'f78', small: 'f84' } },
  '5d':  { fid: 'f164', fields: { net: 'f164', netPct: 'f165', super: 'f166', big: 'f169', medium: 'f172', small: 'f175' } },
  '10d': { fid: 'f174', fields: { net: 'f174', netPct: 'f175', super: 'f176', big: 'f179', medium: 'f182', small: 'f185' } },
};

cli({
  site: 'eastmoney',
  name: 'money-flow',
  description: '主力资金净流入排行（今日/5日/10日）',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'range', type: 'string', default: 'today', help: '周期：today / 5d / 10d' },
    { name: 'order', type: 'string', default: 'desc', help: '排序：desc (净流入排行) / asc (净流出)' },
    { name: 'limit', type: 'int', default: 20, help: '返回数量 (max 100)' },
  ],
  columns: ['rank', 'code', 'name', 'price', 'changePercent', 'mainNet', 'mainNetRatio', 'superNet', 'bigNet', 'mediumNet', 'smallNet'],
  func: async (_page, args) => {
    const rangeKey = String(args.range ?? 'today').toLowerCase();
    const range = RANGES[rangeKey];
    if (!range) {
      throw new CliError('INVALID_ARGUMENT', `Unknown range "${rangeKey}". Valid: ${Object.keys(RANGES).join(', ')}`);
    }
    const po = String(args.order ?? 'desc').toLowerCase() === 'asc' ? '0' : '1';
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 100));

    const fieldList = [
      'f12', 'f14', 'f2', 'f3',
      range.fields.net, range.fields.netPct,
      range.fields.super, range.fields.big, range.fields.medium, range.fields.small,
    ];

    const url = new URL('https://push2.eastmoney.com/api/qt/clist/get');
    url.searchParams.set('pn', '1');
    url.searchParams.set('pz', String(limit));
    url.searchParams.set('po', po);
    url.searchParams.set('np', '1');
    url.searchParams.set('fltt', '2');
    url.searchParams.set('invt', '2');
    url.searchParams.set('fid', range.fid);
    url.searchParams.set('fs', A_MARKET);
    url.searchParams.set('fields', fieldList.join(','));
    url.searchParams.set('ut', 'b2884a393a59ad64002292a3e90d46a5');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `money-flow failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
    if (diff.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no money-flow data');

    return diff.slice(0, limit).map((it, i) => ({
      rank: i + 1,
      code: it.f12,
      name: it.f14,
      price: it.f2,
      changePercent: it.f3,
      mainNet: it[range.fields.net],
      mainNetRatio: it[range.fields.netPct],
      superNet: it[range.fields.super],
      bigNet: it[range.fields.big],
      mediumNet: it[range.fields.medium],
      smallNet: it[range.fields.small],
    }));
  },
});
