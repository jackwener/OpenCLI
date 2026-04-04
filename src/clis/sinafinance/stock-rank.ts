/**
 * Sinafinance stock rank
 */

import { cli, Strategy } from '../../registry.js';

cli({
  site: 'sinafinance',
  name: 'stock-rank',
  description: '新浪财经热搜榜',
  domain: 'finance.sina.cn',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'market', type: 'string', default: 'cn', choices: ['cn', 'hk', 'us', 'wh', 'ft'], help: 'Market: cn (A股), hk (港股), us (美股), wh (外汇), ft (期货)' },
  ],
  columns: ['rank', 'name', 'symbol', 'market', 'price', 'change', 'url'],
  func: async (page, _args) => {
    const market = _args.market || 'cn';

    await page.goto('https://finance.sina.cn/');
    await page.wait({ selector: '#actionSearch', timeout: 10000 });

    const payload = await page.evaluate(`
      (async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const cleanText = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const marketType = ${JSON.stringify(market)};

        const searchBtn = document.querySelector('#actionSearch');
        if (searchBtn) {
          searchBtn.dispatchEvent(new Event('tap', { bubbles: true }));
          await wait(3000);
        }

        const tabEl = document.querySelector('[data-type="' + marketType + '"]');
        const marketName = tabEl?.textContent || marketType;
        if (marketType !== 'cn' && tabEl) {
          tabEl.click();
          await wait(2000);
        }

        const results = [];
        document.querySelectorAll('#stock-list .j-stock-row').forEach(el => {
          const rankEl = el.querySelector('.rank');
          const nameEl = el.querySelector('.j-sname');
          const codeEl = el.querySelector('.stock-code');
          const priceEl = el.querySelector('.j-price');
          const changeEl = el.querySelector('.j-change');
          const openUrl = el.getAttribute('open-url') || '';
          const fullUrl = openUrl ? 'https:' + openUrl : '';
          results.push({
            rank: cleanText(rankEl?.textContent || ''),
            name: cleanText(nameEl?.textContent || ''),
            symbol: cleanText(codeEl?.textContent || ''),
            market: cleanText(marketName),
            price: cleanText(priceEl?.textContent || ''),
            change: cleanText(changeEl?.textContent || ''),
            url: fullUrl,
          });
        });
        return results;
      })()
    `);
    if (!Array.isArray(payload)) return [];
    return payload;
  },
});
