/**
 * Weibo search — browser DOM extraction from search results.
 */
import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';

cli({
  site: 'weibo',
  name: 'search',
  description: '搜索微博',
  domain: 's.weibo.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'keyword', required: true, positional: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of results (max 50)' },
  ],
  columns: ['rank', 'title', 'author', 'time', 'url'],
  func: async (page, kwargs) => {
    const limit = Math.max(1, Math.min(Number(kwargs.limit) || 10, 50));
    const keyword = encodeURIComponent(String(kwargs.keyword ?? '').trim());

    await page.goto(`https://s.weibo.com/weibo?q=${keyword}`);
    await page.wait(2);

    const data = await page.evaluate(`
      (() => {
        const clean = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const absoluteUrl = (href) => {
          if (!href) return '';
          if (href.startsWith('http://') || href.startsWith('https://')) return href;
          if (href.startsWith('//')) return window.location.protocol + href;
          if (href.startsWith('/')) return window.location.origin + href;
          return href;
        };

        const cards = Array.from(document.querySelectorAll('.card-wrap'));
        const rows = [];

        for (const card of cards) {
          const contentEl =
            card.querySelector('[node-type="feed_list_content_full"]') ||
            card.querySelector('[node-type="feed_list_content"]') ||
            card.querySelector('.txt');
          const authorEl =
            card.querySelector('.info .name') ||
            card.querySelector('.name');
          const timeEl = card.querySelector('.from a');
          const urlEl =
            card.querySelector('.from a[href*="/detail/"]') ||
            card.querySelector('.from a[href*="/status/"]') ||
            timeEl;

          const title = clean(contentEl && contentEl.textContent);
          if (!title) continue;

          rows.push({
            title,
            author: clean(authorEl && authorEl.textContent),
            time: clean(timeEl && timeEl.textContent),
            url: absoluteUrl(urlEl && urlEl.getAttribute('href')),
          });
        }

        return rows;
      })()
    `);

    if (!Array.isArray(data) || data.length === 0) {
      throw new CliError('NOT_FOUND', 'No Weibo search results found', 'Try a different keyword or ensure you are logged into weibo.com');
    }

    return data.slice(0, limit).map((item, index) => ({
      rank: index + 1,
      ...item,
    }));
  },
});
