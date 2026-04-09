import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'xueqiu',
  name: 'watchlist',
  description: '获取雪球自选股/模拟组合股票列表',
  domain: 'xueqiu.com',
  browser: true,
  args: [
    {
      name: 'pid',
      default: '-1',
      help: '分组ID：-1=全部(默认) -4=模拟 -5=沪深 -6=美股 -7=港股 -10=实盘 0=持仓（通过 xueqiu groups 获取）',
    },
    { name: 'limit', type: 'int', default: 100, help: '默认 100' },
  ],
  columns: ['symbol', 'name', 'price', 'changePercent'],
  pipeline: [
    { navigate: 'https://xueqiu.com' },
    { evaluate: `(async () => {
  const pid = \${{ args.pid | json }} || '-1';
  const resp = await fetch(\`https://stock.xueqiu.com/v5/stock/portfolio/stock/list.json?size=100&category=1&pid=\${encodeURIComponent(pid)}\`, {credentials: 'include'});
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' Hint: Not logged in?');
  const d = await resp.json();
  if (!d.data || !d.data.stocks) throw new Error('获取失败，可能未登录');

  return d.data.stocks.map(s => ({
    symbol: s.symbol,
    name: s.name,
    price: s.current,
    change: s.chg,
    changePercent: s.percent != null ? s.percent.toFixed(2) + '%' : null,
    volume: s.volume,
    url: 'https://xueqiu.com/S/' + s.symbol
  }));
})()
` },
    { map: {
        symbol: '${{ item.symbol }}',
        name: '${{ item.name }}',
        price: '${{ item.price }}',
        changePercent: '${{ item.changePercent }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
