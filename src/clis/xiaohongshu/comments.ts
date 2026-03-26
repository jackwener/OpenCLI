/**
 * Xiaohongshu comments — DOM extraction from note detail page.
 * XHS API requires signed requests, so we scrape the rendered DOM instead.
 */

import { cli, Strategy } from '../../registry.js';
import { AuthRequiredError, EmptyResultError } from '../../errors.js';

cli({
  site: 'xiaohongshu',
  name: 'comments',
  description: '获取小红书笔记评论（仅主评论，不含楼中楼）',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'note-id', required: true, positional: true, help: 'Note ID or full /explore/<id> URL' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of comments (max 50)' },
  ],
  columns: ['rank', 'author', 'text', 'likes', 'time'],
  func: async (page, kwargs) => {
    const limit = Math.min(Number(kwargs.limit) || 20, 50);
    let noteId = String(kwargs['note-id']).trim();

    // Accept full URLs: /explore/<id> or /note/<id>
    const urlMatch = noteId.match(/\/explore\/([a-f0-9]+)/) || noteId.match(/\/note\/([a-f0-9]+)/);
    if (urlMatch) noteId = urlMatch[1];

    await page.goto(`https://www.xiaohongshu.com/explore/${noteId}`);
    await page.wait(3);

    const data = await page.evaluate(`
      (async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms))

        // Check login state
        const loginWall = /登录后查看|请登录/.test(document.body.innerText || '')

        // Scroll the note container to trigger comment loading
        const scroller = document.querySelector('.note-scroller') || document.querySelector('.container')
        if (scroller) {
          for (let i = 0; i < 3; i++) {
            scroller.scrollTo(0, scroller.scrollHeight)
            await wait(1000)
          }
        }

        const clean = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim()

        const results = []
        const parents = document.querySelectorAll('.parent-comment')
        for (const p of parents) {
          const item = p.querySelector('.comment-item')
          if (!item) continue

          const author = clean(item.querySelector('.author-wrapper .name, .user-name'))
          const text = clean(item.querySelector('.content, .note-text'))
          // XHS shows text "赞" when likes = 0; only shows a number when > 0
          const likesRaw = clean(item.querySelector('.count'))
          const likes = /^\\d+$/.test(likesRaw) ? Number(likesRaw) : 0
          const time = clean(item.querySelector('.date, .time'))

          if (!text) continue
          results.push({ author, text, likes, time })
        }

        return { loginWall, results }
      })()
    `);

    if (!data || typeof data !== 'object') {
      throw new EmptyResultError('xiaohongshu/comments', 'Unexpected evaluate response');
    }

    if ((data as any).loginWall) {
      throw new AuthRequiredError('www.xiaohongshu.com', 'Note comments require login');
    }

    const results: any[] = (data as any).results ?? [];
    return results.slice(0, limit).map((c: any, i: number) => ({ rank: i + 1, ...c }));
  },
});
