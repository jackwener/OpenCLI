// eastmoney kline — historical OHLCV for one stock, any timeframe.
//
// Data source: push2his.eastmoney.com (Tier 1 public JSON).
//   opencli eastmoney kline 600519 --period day --limit 30
//   opencli eastmoney kline sh600519 --period week --adjust forward

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { resolveSecid } from './_secid.js';

const PERIOD_MAP = {
  '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60,
  minute: 1, hour: 60,
  day: 101, daily: 101,
  week: 102, weekly: 102,
  month: 103, monthly: 103,
};

const ADJUST_MAP = {
  none: 0, no: 0, off: 0,
  forward: 1, front: 1, 'pre': 1,
  backward: 2, back: 2, 'post': 2,
};

cli({
  site: 'eastmoney',
  name: 'kline',
    access: 'read',
  description: 'K线历史数据（分/日/周/月/前复权/后复权）',
  domain: 'push2his.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'symbol', required: true, positional: true, help: '股票代码（A/HK/US 均可）' },
    { name: 'period', type: 'string', default: 'day', help: '周期：1m/5m/15m/30m/60m/day/week/month' },
    { name: 'adjust', type: 'string', default: 'forward', help: '复权：none / forward / backward' },
    { name: 'limit',  type: 'int',    default: 30,        help: '返回最近 N 根（末尾）' },
  ],
  columns: ['date', 'open', 'close', 'high', 'low', 'volume', 'turnover', 'amplitude', 'changePercent', 'change', 'turnoverRate'],
  func: async (args) => {
    const secid = resolveSecid(args.symbol);
    const periodKey = String(args.period ?? 'day').toLowerCase();
    const klt = PERIOD_MAP[periodKey];
    if (klt == null) {
      throw new CliError('INVALID_ARGUMENT', `Unknown period "${periodKey}". Valid: ${Object.keys(PERIOD_MAP).join(', ')}`);
    }
    const adjustKey = String(args.adjust ?? 'forward').toLowerCase();
    const fqt = ADJUST_MAP[adjustKey];
    if (fqt == null) {
      throw new CliError('INVALID_ARGUMENT', `Unknown adjust "${adjustKey}". Valid: none / forward / backward`);
    }
    const limit = Math.max(1, Math.min(Number(args.limit) || 30, 1000));

    const url = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
    url.searchParams.set('secid', secid);
    url.searchParams.set('klt', String(klt));
    url.searchParams.set('fqt', String(fqt));
    url.searchParams.set('beg', '0');
    url.searchParams.set('end', '20500101');
    url.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
    url.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61');
    url.searchParams.set('ut', 'b2884a393a59ad64002292a3e90d46a5');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `eastmoney kline failed: HTTP ${resp.status}`);
    const data = await resp.json();
    /** @type {string[]} */
    const raw = Array.isArray(data?.data?.klines) ? data.data.klines : [];
    if (raw.length === 0) throw new CliError('NO_DATA', `No kline data for ${args.symbol}`);

    return raw.slice(-limit).map((line) => {
      const [date, open, close, high, low, volume, turnover, amplitude, changePercent, change, turnoverRate] = line.split(',');
      return {
        date,
        open: Number(open),
        close: Number(close),
        high: Number(high),
        low: Number(low),
        volume: Number(volume),
        turnover: Number(turnover),
        amplitude: Number(amplitude),
        changePercent: Number(changePercent),
        change: Number(change),
        turnoverRate: Number(turnoverRate),
      };
    });
  },
});
