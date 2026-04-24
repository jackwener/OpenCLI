// eastmoney northbound — live realtime cross-border capital flow (北向/南向).
//
// Returns the latest non-empty minute snapshot of cumulative net flow in 万元.
//   opencli eastmoney northbound
//   opencli eastmoney northbound --direction south

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

cli({
  site: 'eastmoney',
  name: 'northbound',
  description: '沪深港通北向/南向资金当日分时净流入（万元）',
  domain: 'push2.eastmoney.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'direction', type: 'string', default: 'north', help: '方向：north (北向，即外资买A) / south (南向，即内地买港)' },
    { name: 'limit',     type: 'int',    default: 10,      help: '返回最近 N 分钟' },
  ],
  columns: ['time', 'cumulativeNetYi', 'minuteNetYi', 'totalNetYi'],
  func: async (_page, args) => {
    const dir = String(args.direction ?? 'north').toLowerCase();
    if (!['north', 'south', 'n', 's'].includes(dir)) {
      throw new CliError('INVALID_ARGUMENT', `Unknown direction "${dir}". Valid: north / south`);
    }
    const limit = Math.max(1, Math.min(Number(args.limit) || 10, 240));

    const url = new URL('https://push2.eastmoney.com/api/qt/kamtbs.rtmin/get');
    url.searchParams.set('fields1', 'f1,f2,f3,f4');
    url.searchParams.set('fields2', 'f51,f52,f54,f56');
    url.searchParams.set('ut', 'b2884a393a59ad64002292a3e90d46a5');

    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `northbound failed: HTTP ${resp.status}`);
    const data = await resp.json();
    const key = (dir === 'south' || dir === 's') ? 's2n' : 'n2s';
    /** @type {string[]} */
    const rows = Array.isArray(data?.data?.[key]) ? data.data[key] : [];
    if (rows.length === 0) throw new CliError('NO_DATA', `No ${key} data returned`);

    // CSV fields per entry: "HH:MM,cumulative_net(万), minute_net(万), total_net(万)"
    // Drop rows with '-' (after market close or before open). Convert 万元 → 亿元 for readability.
    const valid = rows
      .map((r) => r.split(','))
      .filter((c) => c.length >= 4 && c[1] !== '-');
    if (valid.length === 0) {
      throw new CliError('NO_DATA', `${key} has no valid minute data yet (markets may not be open)`);
    }
    return valid.slice(-limit).map(([time, cum, min, total]) => ({
      time,
      cumulativeNetYi: +(Number(cum) / 10000).toFixed(4),
      minuteNetYi: +(Number(min) / 10000).toFixed(4),
      totalNetYi: +(Number(total) / 10000).toFixed(4),
    }));
  },
});
