/**
 * Xiaohongshu search — DOM-based extraction from search results page.
 * The previous Pinia store + XHR interception approach broke because
 * the API now returns empty items. This version navigates directly to
 * the search results page and extracts data from rendered DOM elements.
 * Ref: https://github.com/jackwener/opencli/issues/10
 */

import { cli, Strategy } from '../../registry.js';

type SearchRow = {
  title: string;
  author: string;
  likes: string;
  url: string;
  author_url: string;
  content: string;
  comment_count: string;
  comments: string[];
};

type SearchListRow = {
  title: string;
  author: string;
  likes: string;
  url: string;
  author_url: string;
};

async function readNoteDetail(page: any, url: string): Promise<Pick<SearchRow, 'title' | 'author' | 'content' | 'comment_count' | 'comments'>> {
  await page.goto(url);
  await page.wait(3);

  const payload = await page.evaluate(`
    (() => {
      const state = window.__INITIAL_STATE__ || {};
      const noteState = state.note || {};
      const detailMap = noteState.noteDetailMap || {};
      const detailKeys = Object.keys(detailMap || {});
      const firstDetail = detailKeys.length ? detailMap[detailKeys[0]] : null;
      const note = firstDetail?.note || {};
      const comments = firstDetail?.comments?.list || [];

      const title = (note.title || '').trim();
      const content = (note.desc || '').trim();
      const author = (note.user?.nickname || '').trim();
      const commentCount = String(note.interactInfo?.commentCount || note.interact_info?.comment_count || comments.length || 0);
      const topComments = comments
        .map((item) => {
          const nickname = (item?.userInfo?.nickname || '').trim();
          const text = (item?.content || '').trim();
          if (!text) return '';
          return nickname ? nickname + ': ' + text : text;
        })
        .filter(Boolean)
        .slice(0, 3);

      return {
        title,
        author,
        content,
        comment_count: commentCount,
        comments: topComments,
      };
    })()
  `);

  if (!payload || typeof payload !== 'object') {
    return { title: '', author: '', content: '', comment_count: '0', comments: [] };
  }

  return {
    title: typeof (payload as any).title === 'string' ? (payload as any).title : '',
    author: typeof (payload as any).author === 'string' ? (payload as any).author : '',
    content: typeof (payload as any).content === 'string' ? (payload as any).content : '',
    comment_count: typeof (payload as any).comment_count === 'string' ? (payload as any).comment_count : '0',
    comments: Array.isArray((payload as any).comments) ? (payload as any).comments : [],
  };
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
  columns: ['rank', 'title', 'author', 'likes', 'comment_count', 'url'],
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
        const results = [];

        const pushResult = (raw) => {
          const url = (raw?.url || '').trim();
          if (!url) return;
          results.push({
            title: (raw?.title || '').trim(),
            author: (raw?.author || '').trim(),
            likes: (raw?.likes || '0').trim(),
            url,
            author_url: (raw?.author_url || '').trim(),
          });
        };

        const normalizeUrl = (href) => {
          if (!href) return '';
          if (href.startsWith('http://') || href.startsWith('https://')) return href;
          if (href.startsWith('/')) return 'https://www.xiaohongshu.com' + href;
          return '';
        };

        const cleanText = (value) => (value || '').replace(/\s+/g, ' ').trim();
        const notes = document.querySelectorAll('section.note-item');
        notes.forEach(el => {
          if (el.classList.contains('query-note-item')) return;

          const titleEl = el.querySelector('.title, .note-title, a.title, .footer .title span');
          const nameEl = el.querySelector('a.author .name, .name, .author-name, .nick-name, a.author');
          const likesEl = el.querySelector('.count, .like-count, .like-wrapper .count');
          const detailLinkEl =
            el.querySelector('a.cover.mask') ||
            el.querySelector('a[href*="/search_result/"]') ||
            el.querySelector('a[href*="/explore/"]') ||
            el.querySelector('a[href*="/note/"]');
          const authorLinkEl = el.querySelector('a.author, a[href*="/user/profile/"]');

          pushResult({
            title: cleanText(titleEl?.textContent || ''),
            author: cleanText(nameEl?.textContent || ''),
            likes: cleanText(likesEl?.textContent || '0'),
            url: normalizeUrl(detailLinkEl?.getAttribute('href') || ''),
            author_url: normalizeUrl(authorLinkEl?.getAttribute('href') || ''),
          });
        });

        if (results.length === 0) {
          const anchors = Array.from(document.querySelectorAll('a.cover.mask, a[href*="/search_result/"]'));
          anchors.forEach(anchor => {
            const card = anchor.closest('section, article, div') || anchor.parentElement;
            if (!card) return;
            const titleEl = card.querySelector('.title, .note-title, .footer .title span, [class*="title"]');
            const nameEl = card.querySelector('a.author .name, .name, .author-name, .nick-name, a.author, [class*="author"], [class*="user"]');
            const likesEl = card.querySelector('.count, .like-count, .like-wrapper .count, [class*="like"]');
            const authorLinkEl = card.querySelector('a.author, a[href*="/user/profile/"]');
            pushResult({
              title: cleanText(titleEl?.textContent || anchor.textContent || ''),
              author: cleanText(nameEl?.textContent || ''),
              likes: cleanText(likesEl?.textContent || '0'),
              url: normalizeUrl(anchor.getAttribute('href') || ''),
              author_url: normalizeUrl(authorLinkEl?.getAttribute('href') || ''),
            });
          });
        }

        const deduped = [];
        const seen = new Set();
        for (const item of results) {
          const key = item.url || item.title;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          deduped.push(item);
        }

        return {
          loginWall,
          bodyPreview: (document.body.innerText || '').slice(0, 400),
          results: deduped,
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

    const data = Array.isArray((payload as any).results) ? (payload as any).results as SearchListRow[] : [];
    const limited = data.slice(0, kwargs.limit);
    const enriched: SearchRow[] = [];

    for (const item of limited) {
      const detail = await readNoteDetail(page, item.url);
      const fallbackTitle = detail.content.split('\n').map((line) => line.trim()).find(Boolean) || '';
      enriched.push({
        title: detail.title || item.title || fallbackTitle,
        author: detail.author || item.author,
        likes: item.likes,
        url: item.url,
        author_url: item.author_url,
        content: detail.content,
        comment_count: detail.comment_count,
        comments: detail.comments,
      });
    }

    return enriched.map((item, i) => ({
      rank: i + 1,
      ...item,
    }));
  },
});
