import { cli, Strategy } from '@jackwener/opencli/registry';

const THS_HOT_URL = 'https://eq.10jqka.com.cn/webpage/ths-hot-list/index.html?showStatusBar=true';

cli({
  site: 'ths',
  name: 'hot-rank',
  description: '同花顺热股榜',
  domain: 'eq.10jqka.com.cn',
  strategy: Strategy.COOKIE,
  navigateBefore: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '返回数量' },
  ],
  columns: ['rank', 'symbol', 'name', 'price', 'changePercent', 'heat', 'tags', 'url'],
  func: async (page, kwargs) => {
    await page.goto(THS_HOT_URL);
    await page.wait({ timeout: 15000 });
    const data = await page.evaluate(`
      (() => {
        const cleanText = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
        const items = document.querySelectorAll('.hot-list li, .rank-list li, .stock-item, [class*="rank"] [class*="item"]');
        const results = [];
        const seen = new Set();
        let rank = 0;
        items.forEach((el) => {
          const symbol = cleanText(el.querySelector('[class*="code"], [class*="symbol"]'));
          const name = cleanText(el.querySelector('[class*="name"]'));
          if (!symbol || !name || seen.has(symbol)) return;
          seen.add(symbol);
          rank++;
          const tagEls = el.querySelectorAll('[class*="tag"], [class*="concept"], [class*="label"]');
          const tags = Array.from(tagEls).map(t => cleanText(t)).filter(Boolean).join(',');
          results.push({
            rank,
            symbol,
            name,
            price: cleanText(el.querySelector('[class*="price"]')),
            changePercent: cleanText(el.querySelector('[class*="change"], [class*="percent"]')),
            heat: cleanText(el.querySelector('[class*="heat"], [class*="count"]')),
            tags,
            url: '',
          });
        });
        return results;
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data.slice(0, kwargs.limit);
  },
});
