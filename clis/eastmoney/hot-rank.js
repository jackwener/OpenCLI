import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'eastmoney',
  name: 'hot-rank',
    access: 'read',
  description: '东方财富热股榜',
  domain: 'guba.eastmoney.com',
  strategy: Strategy.COOKIE,
  navigateBefore: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '返回数量' },
  ],
  columns: ['rank', 'symbol', 'name', 'price', 'changePercent', 'heat', 'url'],
  func: async (page, kwargs) => {
    await page.goto('https://guba.eastmoney.com/rank/');
    await page.wait({ selector: '#rankCont', timeout: 15000 });
    const data = await page.evaluate(`
      (() => {
        const cleanText = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
        const rows = document.querySelectorAll('table.rank_table tbody tr');
        const results = [];
        const seen = new Set();
        let rank = 0;
        rows.forEach((row) => {
          const codeEl = row.querySelector('a.stock_code');
          const href = codeEl?.getAttribute('href') || '';
          const symbolMatch = href.match(/(\\d{6})/);
          if (!symbolMatch) return;
          const symbol = symbolMatch[1];
          if (seen.has(symbol)) return;
          seen.add(symbol);
          rank++;
          const tds = row.querySelectorAll('td');
          results.push({
            rank,
            symbol,
            name: row.querySelector('td.nametd a[title]')?.getAttribute('title') || cleanText(row.querySelector('td.nametd')),
            price: tds[6] ? cleanText(tds[6]) : '',
            changePercent: tds[8] ? cleanText(tds[8]) : '',
            heat: cleanText(row.querySelector('td.fans')),
            url: 'https://guba.eastmoney.com/list,' + symbol + '.html',
          });
        });
        return results;
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data.slice(0, kwargs.limit);
  },
});
