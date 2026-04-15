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
  columns: ['rank', 'symbol', 'name', 'changePercent', 'heat', 'tags', 'url'],
  func: async (page, kwargs) => {
    await page.goto(THS_HOT_URL);
    await page.wait({ timeout: 15000 });
    const data = await page.evaluate(`
      (() => {
        const cleanText = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
        const cards = document.querySelectorAll('div.pt-22.pb-24.bgc-white.border');
        const results = [];
        const seen = new Set();
        cards.forEach((card, idx) => {
          const row = card.querySelector('div.flex.bgc-white');
          if (!row) return;
          const nameEl = row.querySelector('span.ellipsis');
          const name = cleanText(nameEl);
          if (!name || seen.has(name)) return;
          seen.add(name);
          const tagEls = card.querySelectorAll('div.tag.PFSC-R');
          const tags = Array.from(tagEls).map(t => cleanText(t)).filter(Boolean).join(',');
          const rankEl = row.querySelector('div.THSMF-M.bold');
          results.push({
            rank: cleanText(rankEl) || String(idx + 1),
            symbol: '',
            name,
            changePercent: cleanText(row.querySelector('div.range')),
            heat: cleanText(row.querySelector('div.col4 > span')),
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
