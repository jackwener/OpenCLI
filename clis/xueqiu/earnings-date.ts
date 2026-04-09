import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'xueqiu',
  name: 'earnings-date',
  description: '获取股票预计财报发布日期（公司大事）',
  domain: 'xueqiu.com',
  browser: true,
  args: [
    {
      name: 'symbol',
      required: true,
      positional: true,
      help: '股票代码，如 SH600519、SZ000858、00700',
    },
    { name: 'next', type: 'bool', default: false, help: '仅返回最近一次未发布的财报日期' },
    { name: 'limit', type: 'int', default: 10, help: '返回数量，默认 10' },
  ],
  columns: ['date', 'report', 'status'],
  pipeline: [
    { navigate: 'https://xueqiu.com' },
    { evaluate: `(async () => {
  const symbol = (\${{ args.symbol | json }} || '').toUpperCase();
  const onlyNext = \${{ args.next }};
  if (!symbol) throw new Error('Missing argument: symbol');
  const resp = await fetch(
    \`https://stock.xueqiu.com/v5/stock/screener/event/list.json?symbol=\${encodeURIComponent(symbol)}&page=1&size=100\`,
    { credentials: 'include' }
  );
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' Hint: Not logged in?');
  const d = await resp.json();
  if (!d.data || !d.data.items) throw new Error('获取失败: ' + JSON.stringify(d));

  // subtype 2 = 预计财报发布
  let items = d.data.items.filter(item => item.subtype === 2);

  const now = Date.now();
  let results = items.map(item => {
    const ts = item.timestamp;
    const dateStr = ts ? new Date(ts).toISOString().split('T')[0] : null;
    const isFuture = ts && ts > now;
    return {
      date: dateStr,
      report: item.message,
      status: isFuture ? '⏳ 未发布' : '✅ 已发布',
      _ts: ts,
      _future: isFuture
    };
  });

  if (onlyNext) {
    const future = results.filter(r => r._future).sort((a, b) => a._ts - b._ts);
    results = future.length ? [future[0]] : [];
  }

  return results;
})()
` },
    { map: { date: '${{ item.date }}', report: '${{ item.report }}', status: '${{ item.status }}' } },
    { limit: '${{ args.limit }}' },
  ],
});
