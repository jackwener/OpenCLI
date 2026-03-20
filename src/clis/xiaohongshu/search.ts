/**
 * Xiaohongshu search — DOM-based extraction from search results page.
 * The previous Pinia store + XHR interception approach broke because
 * the API now returns empty items. This version navigates directly to
 * the search results page and extracts data from rendered DOM elements.
 * Ref: https://github.com/jackwener/opencli/issues/10
 */

import { cli, Strategy } from '../../registry.js';

cli({
  site: 'xiaohongshu',
  name: 'search',
  description: '搜索小红书笔记',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['rank', 'title', 'author', 'likes'],
  func: async (page, kwargs) => {
    const keyword = encodeURIComponent(kwargs.query);
    await page.goto(
      `https://www.xiaohongshu.com/search_result?keyword=${keyword}&source=web_search_result_notes`
    );
    await page.wait(3);

    // Scroll a couple of times to load more results
    await page.autoScroll({ times: 2 });

    const data = await page.evaluate(`
      (() => {
        const notes = document.querySelectorAll('section.note-item');
        const results = [];
        notes.forEach(el => {
          // Skip "related searches" sections
          if (el.classList.contains('query-note-item')) return;

          const titleEl = el.querySelector('.title, .note-title, a.title');
          const nameEl = el.querySelector('.name, .author-name, .nick-name');
          const likesEl = el.querySelector('.count, .like-count, .like-wrapper .count');
          const linkEl = el.querySelector('a[href*="/explore/"], a[href*="/search_result/"], a[href*="/note/"]');

          const href = linkEl?.getAttribute('href') || '';
          const noteId = href.match(/\\/(?:explore|note)\\/([a-zA-Z0-9]+)/)?.[1] || '';

          results.push({
            title: (titleEl?.textContent || '').trim(),
            author: (nameEl?.textContent || '').trim(),
            likes: (likesEl?.textContent || '0').trim(),
            url: noteId ? 'https://www.xiaohongshu.com/explore/' + noteId : '',
          });
        });
        return results;
      })()
    `);

    if (!Array.isArray(data)) return [];
    return data
      .filter((item: any) => item.title)
      .slice(0, kwargs.limit)
      .map((item: any, i: number) => ({
        rank: i + 1,
        ...item,
      }));
  },
});
