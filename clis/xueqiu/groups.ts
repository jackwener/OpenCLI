import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'xueqiu',
  name: 'groups',
  description: '获取雪球自选股分组列表（含模拟组合）',
  domain: 'xueqiu.com',
  browser: true,
  columns: ['pid', 'name', 'count'],
  pipeline: [
    { navigate: 'https://xueqiu.com' },
    { evaluate: `(async () => {
  const resp = await fetch('https://stock.xueqiu.com/v5/stock/portfolio/list.json?category=1&size=20', {credentials: 'include'});
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' Hint: Not logged in?');
  const d = await resp.json();
  if (!d.data || !d.data.stocks) throw new Error('获取失败，可能未登录');

  return d.data.stocks.map(g => ({
    pid: String(g.id),
    name: g.name,
    count: g.symbol_count || 0
  }));
})()
` },
  ],
});
