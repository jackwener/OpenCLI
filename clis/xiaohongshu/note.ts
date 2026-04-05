/**
 * Xiaohongshu note — read full note content from a public note page.
 *
 * Extracts title, author, description text, and engagement metrics
 * (likes, collects, comment count) via DOM extraction.
 *
 * Supports both bare note IDs and full URLs (with xsec_token).
 * Bare IDs now use /search_result/<id> which works without xsec_token
 * when the user is logged in via cookies.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseNoteId, buildNoteUrl } from './note-helpers.js';

cli({
  site: 'xiaohongshu',
  name: 'note',
  description: '获取小红书笔记正文和互动数据',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'note-id', required: true, positional: true, help: 'Note ID or full URL (preserves xsec_token for access)' },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    const raw = String(kwargs['note-id']);
    const noteId = parseNoteId(raw);
    const url = buildNoteUrl(raw);

    await page.goto(url);
    await page.wait(3);

    const data = await page.evaluate(`
      (() => {
        const loginWall = /登录后查看|请登录/.test(document.body.innerText || '')
        const notFound = /页面不见了|笔记不存在|无法浏览/.test(document.body.innerText || '')

        const clean = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim()

        const title = clean(document.querySelector('#detail-title, .title'))
        const desc = clean(document.querySelector('#detail-desc, .desc, .note-text'))
        const author = clean(document.querySelector('.username, .author-wrapper .name'))
        const likes = clean(document.querySelector('.like-wrapper .count'))
        const collects = clean(document.querySelector('.collect-wrapper .count'))
        const comments = clean(document.querySelector('.chat-wrapper .count'))

        // Try to extract tags/topics
        const tags = []
        document.querySelectorAll('#detail-desc a.tag, #detail-desc a[href*="search_result"]').forEach(el => {
          const t = (el.textContent || '').trim()
          if (t) tags.push(t)
        })

        return { loginWall, notFound, title, desc, author, likes, collects, comments, tags }
      })()
    `);

    if (!data || typeof data !== 'object') {
      throw new EmptyResultError('xiaohongshu/note', 'Unexpected evaluate response');
    }

    if ((data as any).loginWall) {
      throw new AuthRequiredError('www.xiaohongshu.com', 'Note content requires login');
    }

    if ((data as any).notFound) {
      throw new EmptyResultError('xiaohongshu/note', `Note ${noteId} not found or unavailable — it may have been deleted or restricted`);
    }

    const d = data as any;
    // XHS renders placeholder text like "赞"/"收藏"/"评论" when count is 0;
    // normalize to '0' unless the value looks numeric.
    const numOrZero = (v: string) => /^\d+/.test(v) ? v : '0';

    // Title + author are always present on a real note page.
    // If both are missing, the page likely failed to load properly.
    if (!d.title && !d.author) {
      throw new EmptyResultError(
        'xiaohongshu/note',
        'The note page loaded without visible content. The note may be deleted or restricted.',
      );
    }

    const rows = [
      { field: 'title', value: d.title || '' },
      { field: 'author', value: d.author || '' },
      { field: 'content', value: d.desc || '' },
      { field: 'likes', value: numOrZero(d.likes || '') },
      { field: 'collects', value: numOrZero(d.collects || '') },
      { field: 'comments', value: numOrZero(d.comments || '') },
    ];

    if (d.tags?.length) {
      rows.push({ field: 'tags', value: d.tags.join(', ') });
    }

    return rows;
  },
});
