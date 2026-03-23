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
  columns: ['rank', 'title', 'author', 'likes', 'url'],
  func: async (page, kwargs) => {
    const keyword = encodeURIComponent(kwargs.query);
    await page.goto(
      `https://www.xiaohongshu.com/search_result?keyword=${keyword}&source=web_search_result_notes`
    );
    await page.wait(3);

    // Scroll a couple of times to load more results
    await page.autoScroll({ times: 2 });

    const payload = await page.evaluate(`
      (() => {
        const loginWall = /登录后查看搜索结果/.test(document.body.innerText || '');

        const normalizeUrl = (href) => {
          if (!href) return '';
          if (href.startsWith('http://') || href.startsWith('https://')) return href;
          if (href.startsWith('/')) return 'https://www.xiaohongshu.com' + href;
          return '';
        };

        const cleanText = (value) => (value || '').replace(/\\s+/g, ' ').trim();

        const results = [];
        const seen = new Set();

        document.querySelectorAll('section.note-item').forEach(el => {
          // Skip "related searches" sections
          if (el.classList.contains('query-note-item')) return;

          const titleEl = el.querySelector('.title, .note-title, a.title, .footer .title span');
          const nameEl = el.querySelector('a.author .name, .name, .author-name, .nick-name, a.author');
          const likesEl = el.querySelector('.count, .like-count, .like-wrapper .count');
          // Prefer search_result link (preserves xsec_token) over generic /explore/ link
          const detailLinkEl =
            el.querySelector('a.cover.mask') ||
            el.querySelector('a[href*="/search_result/"]') ||
            el.querySelector('a[href*="/explore/"]') ||
            el.querySelector('a[href*="/note/"]');
          const authorLinkEl = el.querySelector('a.author, a[href*="/user/profile/"]');

          const url = normalizeUrl(detailLinkEl?.getAttribute('href') || '');
          if (!url) return;

          const key = url;
          if (seen.has(key)) return;
          seen.add(key);

          results.push({
            title: cleanText(titleEl?.textContent || ''),
            author: cleanText(nameEl?.textContent || ''),
            likes: cleanText(likesEl?.textContent || '0'),
            url,
            author_url: normalizeUrl(authorLinkEl?.getAttribute('href') || ''),
          });
        });

        return {
          loginWall,
          results,
        };
      })()
    `);

    if (!payload || typeof payload !== 'object') return [];

    if ((payload as any).loginWall) {
      throw new Error(
        'Xiaohongshu search results are blocked behind a login wall for the current browser session. ' +
        'Open https://www.xiaohongshu.com/search_result in Chrome and sign in, then retry.'
      );
    }

    const data: any[] = Array.isArray((payload as any).results) ? (payload as any).results : [];
    return data
      .filter((item: any) => item.title)
      .slice(0, kwargs.limit)
      .map((item: any, i: number) => ({
        rank: i + 1,
        ...item,
      }));
  },
});
