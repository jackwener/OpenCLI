import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'xueqiu',
  name: 'kline',
  description: '获取雪球股票K线（历史行情）数据',
  domain: 'xueqiu.com',
  browser: true,
  args: [
    {
      name: 'symbol',
      required: true,
      positional: true,
      help: '股票代码，如 SH600519、SZ000858、AAPL',
    },
    { name: 'days', type: 'int', default: 14, help: '回溯天数（默认14天）' },
  ],
  columns: ['date', 'open', 'high', 'low', 'close', 'volume'],
  pipeline: [
    { navigate: 'https://xueqiu.com' },
    { evaluate: `(async () => {
  const symbol = (\${{ args.symbol | json }} || '').toUpperCase();
  const days = parseInt(\${{ args.days | json }}) || 14;
  if (!symbol) throw new Error('Missing argument: symbol');

  // begin = now minus days (for count=-N, returns N items ending at begin)
  const beginTs = Date.now();
  const resp = await fetch('https://stock.xueqiu.com/v5/stock/chart/kline.json?symbol=' + encodeURIComponent(symbol) + '&begin=' + beginTs + '&period=day&type=before&count=-' + days, {credentials: 'include'});
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' Hint: Not logged in?');
  const d = await resp.json();

  if (!d.data || !d.data.item || d.data.item.length === 0) return [];

  const columns = d.data.column || [];
  const items = d.data.item || [];
  const colIdx = {};
  columns.forEach((name, i) => { colIdx[name] = i; });

  function fmt(v) { return v == null ? null : v; }

  return items.map(row => ({
    date: colIdx.timestamp != null ? new Date(row[colIdx.timestamp]).toISOString().split('T')[0] : null,
    open: fmt(row[colIdx.open]),
    high: fmt(row[colIdx.high]),
    low: fmt(row[colIdx.low]),
    close: fmt(row[colIdx.close]),
    volume: fmt(row[colIdx.volume]),
    amount: fmt(row[colIdx.amount]),
    chg: fmt(row[colIdx.chg]),
    percent: fmt(row[colIdx.percent]),
    symbol: symbol
  }));
})()
` },
    { map: {
        date: '${{ item.date }}',
        open: '${{ item.open }}',
        high: '${{ item.high }}',
        low: '${{ item.low }}',
        close: '${{ item.close }}',
        volume: '${{ item.volume }}',
        percent: '${{ item.percent }}',
      } },
  ],
});
