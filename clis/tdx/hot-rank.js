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
  columns: ['rank', 'symbol', 'name', 'changePercent', 'heat', 'tags'],
  func: async (page, kwargs) => {
    await page.goto(TDX_HOT_URL);
    await page.wait({ timeout: 15000 });
    const data = await page.evaluate(`
      (() => {
        const cleanText = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
        const cells = document.querySelectorAll('div.top-cell[data-code]');
        const results = [];
        const seen = new Set();
        cells.forEach((cell, idx) => {
          const symbol = cell.getAttribute('data-code') || '';
          const name = cell.getAttribute('data-name') || '';
          if (!symbol || !name || seen.has(symbol)) return;
          seen.add(symbol);
          const tagEls = cell.querySelectorAll('div.tips-item.gnbk');
          const tags = Array.from(tagEls).map(t => cleanText(t)).filter(Boolean).join(',');
          results.push({
            rank: idx + 1,
            symbol,
            name,
            changePercent: cleanText(cell.querySelector('div.top-zf')),
            heat: cleanText(cell.querySelector('div.hotN')),
            tags,
          });
        });
        return results;
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data.slice(0, kwargs.limit);
  },
});
