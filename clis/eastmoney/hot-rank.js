import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'eastmoney',
  name: 'hot-rank',
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
        const items = document.querySelectorAll('#rankCont a[href*="list,"], #rankCont .stocklist li, #rankCont tbody tr');
        const results = [];
        const seen = new Set();
        items.forEach((el, idx) => {
          const href = el.getAttribute('href') || el.querySelector('a')?.getAttribute('href') || '';
          const symbolMatch = href.match(/,(\\d{6})\\.?/);
          if (!symbolMatch) return;
          const symbol = symbolMatch[1];
          if (seen.has(symbol)) return;
          seen.add(symbol);
          const spans = el.querySelectorAll('span, td');
          results.push({
            rank: idx + 1,
            symbol,
            name: cleanText(el.querySelector('.name, .stockname, [class*="name"]') || spans[1]),
            price: cleanText(el.querySelector('.price, [class*="price"]') || spans[2]),
            changePercent: cleanText(el.querySelector('.change, [class*="change"]') || spans[3]),
            heat: cleanText(el.querySelector('.heat, [class*="heat"], [class*="count"]') || spans[4]),
            url: href.startsWith('http') ? href : 'https://guba.eastmoney.com' + href,
          });
        });
        return results;
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data.slice(0, kwargs.limit);
  },
});
