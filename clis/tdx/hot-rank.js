import { cli, Strategy } from '@jackwener/opencli/registry';

const TDX_HOT_URL = 'https://pul.tdx.com.cn/site/app/gzhbd/tdx-topsearch/page-main.html?pageName=page_topsearch&tabClickIndex=0&subtabIndex=0';

cli({
  site: 'tdx',
  name: 'hot-rank',
  description: '通达信热搜榜',
  domain: 'pul.tdx.com.cn',
  strategy: Strategy.COOKIE,
  navigateBefore: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '返回数量' },
  ],
  columns: ['rank', 'symbol', 'name', 'price', 'changePercent', 'heat', 'url'],
  func: async (page, kwargs) => {
    await page.goto(TDX_HOT_URL);
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
          results.push({
            rank,
            symbol,
            name,
            price: cleanText(el.querySelector('[class*="price"]')),
            changePercent: cleanText(el.querySelector('[class*="change"], [class*="percent"]')),
            heat: cleanText(el.querySelector('[class*="heat"], [class*="count"], [class*="search"]')),
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
