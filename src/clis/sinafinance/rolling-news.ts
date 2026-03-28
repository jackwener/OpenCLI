/**
 * Sinafinance rolling news feed
 */

import { cli, Strategy } from '../../registry.js';

cli({
  site: 'sinafinance',
  name: 'rolling-news',
  description: '新浪财经滚动新闻',
  domain: 'finance.sina.com.cn/roll',
  strategy: Strategy.COOKIE,
  args: [],
  columns: ['column', 'title', 'date', 'url'],
  func: async (page, _args) => {
    await page.goto(`https://finance.sina.com.cn/roll/#pageid=384&lid=2519`);
    await page.wait({ selector: '.d_list_txt li', timeout: 10000 });

    const payload = await page.evaluate(`
      (() => {
        const cleanText = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const results = [];
        document.querySelectorAll('.d_list_txt li').forEach(el => {
          const titleEl = el.querySelector('.c_tit a');
          const columnEl = el.querySelector('.c_chl');
          const dateEl = el.querySelector('.c_time');
          const url = titleEl?.getAttribute('href') || '';
          if (!url) return;
          results.push({
            title: cleanText(titleEl?.textContent || ''),
            column: cleanText(columnEl?.textContent || ''),
            date: cleanText(dateEl?.textContent || ''),
            url: url,
          });
        });
        return results;
      })()
    `);
    if (!Array.isArray(payload)) return [];
    return payload;
  },
});
