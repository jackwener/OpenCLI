// eastmoney convertible — on-market convertible bond listing.
//
//   opencli eastmoney convertible
//   opencli eastmoney convertible --sort premium --limit 30

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const SORTS = {
  change:        { fid: 'f3',   order: 'desc' },
  drop:          { fid: 'f3',   order: 'asc' },
  turnover:      { fid: 'f6',   order: 'desc' },
  price:         { fid: 'f2',   order: 'desc' },
  premium:       { fid: 'f237', order: 'desc' }, // 转股溢价率
  value:         { fid: 'f236', order: 'desc' }, // 转股价值
  // #2109: f239 is the putback trigger price (= convPrice × 0.7), not YTM.
  // Renamed so `--sort` no longer claims to order by a value it doesn't hold.
  'put-trigger': { fid: 'f239', order: 'desc' }, // 回售触发价
};

const NUMERIC_FIELDS = [
  'f2', 'f3', 'f229', 'f230', 'f235', 'f236', 'f237', 'f238', 'f239',
];

function isEastmoneyScalar(value) {
  return typeof value === 'string' || typeof value === 'number';
}

function normalizeEastmoneyNumeric(value, field, bondCode) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // Eastmoney uses "-" for temporarily unavailable quote metrics.
  if (value === '-') return value;
  throw new CommandExecutionError(`eastmoney convertible returned malformed ${field} for ${bondCode || 'unknown bond'}`);
}

function normalizeEastmoneyString(value, field, bondCode) {
  if (isEastmoneyScalar(value)) return String(value);
  throw new CommandExecutionError(`eastmoney convertible returned malformed ${field} for ${bondCode || 'unknown bond'}`);
}

function normalizeEastmoneyIdentityString(value, field, bondCode) {
  if (typeof value === 'string' && value.trim()) return value;
  throw new CommandExecutionError(`eastmoney convertible returned malformed ${field} for ${bondCode || 'unknown bond'}`);
}

export function parseConvertibleLimit(value) {
  if (value === undefined || value === null || value === '') return 20;
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 1 && value <= 100) return value;
    throw new ArgumentError('eastmoney convertible --limit must be an integer between 1 and 100');
  }
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) throw new ArgumentError('eastmoney convertible --limit must be an integer between 1 and 100');
  const parsed = Number(raw);
  if (parsed < 1 || parsed > 100) throw new ArgumentError('eastmoney convertible --limit must be an integer between 1 and 100');
  return parsed;
}

export function extractConvertibleDiff(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CommandExecutionError('eastmoney convertible returned a malformed response envelope');
  }
  if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data)) {
    throw new CommandExecutionError('eastmoney convertible returned a malformed data envelope');
  }
  const diff = data.data.diff;
  if (!Array.isArray(diff)) {
    throw new CommandExecutionError('eastmoney convertible returned malformed diff data');
  }
  if (diff.length === 0) {
    throw new EmptyResultError('eastmoney convertible');
  }
  return diff;
}

// Map a raw eastmoney clist `diff` item to an output row.
//
// #2109: f238 / f239 were previously emitted as `remainingYears` / `ytm`, but
// cross-verification (12/12 fingerprint hits) shows f239 is the putback trigger
// price (= convPrice × 0.7) and f238 is the pure-bond premium %. Real YTM /
// remaining term are not in this response's `fields`; adding the correct f-codes
// is a follow-up that needs a live push2 field dump cross-checked against jisilu.
export function mapConvertibleRow(it, rank) {
  if (!it || typeof it !== 'object' || Array.isArray(it)) {
    throw new CommandExecutionError(`eastmoney convertible returned malformed row at rank ${rank}`);
  }
  const bondCode = normalizeEastmoneyIdentityString(it.f12, 'f12', '');
  const bondName = normalizeEastmoneyIdentityString(it.f14, 'f14', bondCode);
  const stockCode = normalizeEastmoneyIdentityString(it.f232, 'f232', bondCode);
  const stockName = normalizeEastmoneyIdentityString(it.f234, 'f234', bondCode);
  for (const field of NUMERIC_FIELDS) {
    normalizeEastmoneyNumeric(it[field], field, bondCode);
  }
  return {
    rank,
    bondCode,
    bondName,
    bondPrice: normalizeEastmoneyNumeric(it.f2, 'f2', bondCode),
    bondChangePct: normalizeEastmoneyNumeric(it.f3, 'f3', bondCode),
    stockCode,
    stockName,
    stockPrice: normalizeEastmoneyNumeric(it.f229, 'f229', bondCode),
    stockChangePct: normalizeEastmoneyNumeric(it.f230, 'f230', bondCode),
    convPrice: normalizeEastmoneyNumeric(it.f235, 'f235', bondCode),
    convValue: normalizeEastmoneyNumeric(it.f236, 'f236', bondCode),
    convPremiumPct: normalizeEastmoneyNumeric(it.f237, 'f237', bondCode),
    pureBondPremiumPct: normalizeEastmoneyNumeric(it.f238, 'f238', bondCode),
    putTriggerPrice: normalizeEastmoneyNumeric(it.f239, 'f239', bondCode),
    listDate: normalizeEastmoneyString(it.f243 ?? '', 'f243', bondCode),
  };
}

export function mapConvertibleRows(diff, limit) {
  if (!Array.isArray(diff)) throw new CommandExecutionError('eastmoney convertible returned malformed diff data');
  const capped = Number.isInteger(limit) && limit > 0 ? diff.slice(0, limit) : diff;
  return capped.map((it, i) => mapConvertibleRow(it, i + 1));
}

cli({
  site: 'eastmoney',
  name: 'convertible',
    access: 'read',
  description: '可转债行情列表（默认按成交额排序）',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'sort',  type: 'string', default: 'turnover', help: '排序：turnover / change / drop / price / premium / value / put-trigger' },
    { name: 'limit', type: 'int',    default: 20,         help: '返回数量 (max 100)' },
  ],
  columns: ['rank', 'bondCode', 'bondName', 'bondPrice', 'bondChangePct', 'stockCode', 'stockName', 'stockPrice', 'stockChangePct', 'convPrice', 'convValue', 'convPremiumPct', 'pureBondPremiumPct', 'putTriggerPrice', 'listDate'],
  func: async (args) => {
    const sortKey = String(args.sort ?? 'turnover').toLowerCase();
    const sort = SORTS[sortKey];
    if (!sort) throw new ArgumentError(`Unknown sort "${sortKey}". Valid: ${Object.keys(SORTS).join(', ')}`);
    const limit = parseConvertibleLimit(args.limit);

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
    if (!resp.ok) throw new CommandExecutionError(`eastmoney convertible failed: HTTP ${resp.status}`);
    let data;
    try {
      data = await resp.json();
    } catch (error) {
      throw new CommandExecutionError(`eastmoney convertible returned invalid JSON: ${error?.message ?? error}`);
    }
    const diff = extractConvertibleDiff(data);

    return mapConvertibleRows(diff, limit);
  },
});

export const __test__ = { SORTS, extractConvertibleDiff, mapConvertibleRow, mapConvertibleRows, parseConvertibleLimit };
