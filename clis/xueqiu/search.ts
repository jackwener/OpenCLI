import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'xueqiu',
  name: 'search',
  description: '搜索雪球股票（代码或名称）',
  domain: 'xueqiu.com',
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: '搜索关键词，如 茅台、AAPL、腾讯' },
    { name: 'limit', type: 'int', default: 10, help: '返回数量，默认 10' },
  ],
  columns: ['symbol', 'name', 'exchange', 'price', 'changePercent', 'url'],
  pipeline: [
    { navigate: 'https://xueqiu.com' },
    { evaluate: `(async () => {
  const query = \${{ args.query | json }};
  const count = \${{ args.limit }};
  const resp = await fetch(\`https://xueqiu.com/stock/search.json?code=\${encodeURIComponent(query)}&size=\${count}\`, {credentials: 'include'});
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' Hint: Not logged in?');
  const d = await resp.json();
  return (d.stocks || []).map(s => {
    let symbol = '';
    if (s.exchange === 'SH' || s.exchange === 'SZ' || s.exchange === 'BJ') {
      symbol = s.code.startsWith(s.exchange) ? s.code : s.exchange + s.code;
    } else {
      symbol = s.code;
    }
    return {
      symbol: symbol,
      name: s.name,
      exchange: s.exchange,
      price: s.current,
      changePercent: s.percentage != null ? s.percentage.toFixed(2) + '%' : null,
      url: 'https://xueqiu.com/S/' + symbol
    };
  });
})()
` },
    { map: {
        symbol: '${{ item.symbol }}',
        name: '${{ item.name }}',
        exchange: '${{ item.exchange }}',
        price: '${{ item.price }}',
        changePercent: '${{ item.changePercent }}',
        url: '${{ item.url }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
