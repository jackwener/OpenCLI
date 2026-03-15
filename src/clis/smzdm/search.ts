/**
 * 什么值得买搜索好价 — browser cookie, HTML parse.
 * Source: bb-sites/smzdm/search.js
 */
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'smzdm',
  name: 'search',
  description: '什么值得买搜索好价',
  domain: 'www.smzdm.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'keyword', required: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['rank', 'title', 'price', 'mall', 'comments', 'url'],
  func: async (page, kwargs) => {
    const q = encodeURIComponent(kwargs.keyword);
    const limit = kwargs.limit || 20;
    await page.goto('https://www.smzdm.com');
    await page.wait(2);
    const data = await page.evaluate(`
      (async () => {
        const q = '${q}';
        const limit = ${limit};
        // Try youhui channel first, then home
        for (const channel of ['youhui', 'home']) {
          try {
            const resp = await fetch('https://search.smzdm.com/ajax/?c=' + channel + '&s=' + q + '&p=1&v=b', {
              credentials: 'include',
              headers: {'X-Requested-With': 'XMLHttpRequest'}
            });
            if (!resp.ok) continue;
            const html = await resp.text();
            if (html.indexOf('feed-row-wide') === -1) continue;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const items = doc.querySelectorAll('li.feed-row-wide');
            const results = [];
            items.forEach((li, i) => {
              if (results.length >= limit) return;
              const titleEl = li.querySelector('h5.feed-block-title > a')
                           || li.querySelector('h5 > a');
              if (!titleEl) return;
              const title = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
              const url = titleEl.getAttribute('href') || '';
              const priceEl = li.querySelector('.z-highlight');
              const price = priceEl ? priceEl.textContent.trim() : '';
              let mall = '';
              const extrasSpan = li.querySelector('.z-feed-foot-r .feed-block-extras span');
              if (extrasSpan) mall = extrasSpan.textContent.trim();
              const commentEl = li.querySelector('.feed-btn-comment');
              const comments = commentEl ? parseInt(commentEl.textContent.trim()) || 0 : 0;
              results.push({rank: results.length + 1, title, price, mall, comments, url});
            });
            if (results.length > 0) return results;
          } catch(e) { continue; }
        }
        return {error: 'No results'};
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data;
  },
});
