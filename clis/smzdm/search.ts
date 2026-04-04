/**
 * 什么值得买搜索好价 — browser cookie, DOM scraping.
 *
 * Fix: The old adapter used `search.smzdm.com/ajax/` which returns 404.
 * New approach: navigate to `search.smzdm.com/?c=home&s=<keyword>&v=b`
 * and scrape the rendered DOM directly.
 */
import { cli, Strategy } from '../../src/registry.js';

cli({
  site: 'smzdm',
  name: 'search',
  description: '什么值得买搜索好价',
  domain: 'www.smzdm.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['rank', 'title', 'price', 'mall', 'comments', 'url'],
  func: async (page, kwargs) => {
    const q = encodeURIComponent(kwargs.query);
    const limit = kwargs.limit || 20;

    // Navigate directly to search results page
    await page.goto(`https://search.smzdm.com/?c=home&s=${q}&v=b`);

    const data = await page.evaluate(`
      (() => {
        const limit = ${limit};
        const items = document.querySelectorAll('li.feed-row-wide');
        const results = [];
        items.forEach((li) => {
          if (results.length >= limit) return;
          const titleEl = li.querySelector('h5.feed-block-title > a')
                       || li.querySelector('h5 > a');
          if (!titleEl) return;
          const title = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
          const url = titleEl.getAttribute('href') || titleEl.href || '';
          const priceEl = li.querySelector('.z-highlight');
          const price = priceEl ? priceEl.textContent.trim() : '';
          let mall = '';
          const mallEl = li.querySelector('.z-feed-foot-r .feed-block-extras span')
                      || li.querySelector('.z-feed-foot-r span');
          if (mallEl) mall = mallEl.textContent.trim();
          const commentEl = li.querySelector('.feed-btn-comment');
          const comments = commentEl ? parseInt(commentEl.textContent.trim()) || 0 : 0;
          results.push({ rank: results.length + 1, title, price, mall, comments, url });
        });
        return results;
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data;
  },
});
