// eastmoney quote — live quote for one or more stocks (A/HK/US).
//
// Data source: push2.eastmoney.com (Tier 1 public JSON, no auth).
// Supported inputs (comma / space separated):
//   600000, sh600000, 000001, sz000001, 00700.HK, hk00700, AAPL, us.AAPL
//
//   opencli eastmoney quote 600000 --fields all
//   opencli eastmoney quote "sh600000,sz000001,00700.HK"

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { resolveSecid, splitSymbols } from './_secid.js';

const FIELDS = [
  'f12', // code
  'f13', // market
  'f14', // name
  'f2',  // price
  'f3',  // changePercent
  'f4',  // change
  'f5',  // volume (手)
  'f6',  // turnover (CNY)
  'f7',  // amplitude %
  'f8',  // turnoverRate %
  'f9',  // peDynamic
  'f10', // volumeRatio
  'f15', // high
  'f16', // low
  'f17', // open
  'f18', // prevClose
  'f20', // marketCap
  'f21', // floatMarketCap
  'f23', // priceBook
].join(',');

function marketLabel(f13) {
  if (f13 === 1) return 'SH';
  if (f13 === 0) return 'SZ/BJ';
  if (f13 === 116) return 'HK';
  if (f13 === 105 || f13 === 106 || f13 === 107) return 'US';
  return String(f13 ?? '');
}

cli({
  site: 'eastmoney',
  name: 'quote',
    access: 'read',
  description: '个股实时行情（A股 / 港股 / 美股）— 来自 push2.eastmoney.com',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'symbols', required: true, positional: true, help: '股票代码（可用逗号/空格分隔多个）' },
  ],
  columns: [
    'code', 'name', 'market', 'price', 'changePercent', 'change',
    'open', 'high', 'low', 'prevClose', 'volume', 'turnover',
    'turnoverRate', 'amplitude', 'peDynamic', 'priceBook',
    'marketCap', 'floatMarketCap',
  ],
  func: async (args) => {
    const raw = splitSymbols(args.symbols);
    if (raw.length === 0) {
      throw new CliError('INVALID_ARGUMENT', 'At least one symbol is required');
    }

    /** @type {string[]} */
    const secids = [];
    for (const s of raw) {
      try { secids.push(resolveSecid(s)); }
      catch (err) { throw new CliError('INVALID_ARGUMENT', `Unrecognized symbol "${s}"`); }
    }

    // Multi-stock in one call via ulist.np
    const url = new URL('https://push2.eastmoney.com/api/qt/ulist.np/get');
    url.searchParams.set('secids', secids.join(','));
    url.searchParams.set('fltt', '2');
    url.searchParams.set('fields', FIELDS);
    url.searchParams.set('ut', 'bd1d9ddb04089700cf9c27f6f7426281');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `eastmoney quote failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const diff = Array.isArray(data?.data?.diff) ? data.data.diff : [];
    if (diff.length === 0) throw new CliError('NO_DATA', 'eastmoney returned no quotes', `Check symbols: ${raw.join(', ')}`);

    return diff.map((it) => ({
      code: it.f12,
      name: it.f14,
      market: marketLabel(it.f13),
      price: it.f2,
      changePercent: it.f3,
      change: it.f4,
      open: it.f17,
      high: it.f15,
      low: it.f16,
      prevClose: it.f18,
      volume: it.f5,
      turnover: it.f6,
      turnoverRate: it.f8,
      amplitude: it.f7,
      peDynamic: it.f9,
      priceBook: it.f23,
      marketCap: it.f20,
      floatMarketCap: it.f21,
    }));
  },
});
