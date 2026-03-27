/**
 * Xiaohongshu search — DOM-based extraction from search results page.
 * The previous Pinia store + XHR interception approach broke because
 * the API now returns empty items. This version navigates directly to
 * the search results page and extracts data from rendered DOM elements.
 * Ref: https://github.com/jackwener/opencli/issues/10
 */

import { cli, Strategy } from '../../registry.js';
import { AuthRequiredError } from '../../errors.js';

/**
 * Extract approximate publish date from a Xiaohongshu note URL.
 * XHS note IDs follow MongoDB ObjectID format where the first 8 hex
 * characters encode a Unix timestamp (the moment the ID was generated,
 * which closely matches publish time but is not an official API field).
 * e.g. "697f6c74..." → 0x697f6c74 = 1769958516 → 2026-02-01
 */
export function noteIdToDate(url: string): string {
  const match = url.match(/\/(?:search_result|explore|note)\/([0-9a-f]{24})(?=[?#/]|$)/i);
  if (!match) return '';
  const hex = match[1].substring(0, 8);
  const ts = parseInt(hex, 16);
  if (!ts || ts < 1_000_000_000 || ts > 4_000_000_000) return '';
  // Offset by UTC+8 (China Standard Time) so the date matches what XHS users see
  return new Date((ts + 8 * 3600) * 1000).toISOString().slice(0, 10);
}

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
  columns: ['rank', 'title', 'author', 'likes', 'published_at', 'url'],
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
      throw new AuthRequiredError('www.xiaohongshu.com', 'Xiaohongshu search results are blocked behind a login wall');
    }

    const data: any[] = Array.isArray((payload as any).results) ? (payload as any).results : [];
    return data
      .filter((item: any) => item.title)
      .slice(0, kwargs.limit)
      .map((item: any, i: number) => ({
        rank: i + 1,
        ...item,
        published_at: noteIdToDate(item.url),
      }));
  },
});
