/**
 * Xiaohongshu comments — DOM extraction from note detail page.
 * XHS API requires signed requests, so we scrape the rendered DOM instead.
 *
 * Supports both top-level comments and nested replies (楼中楼) via
 * the --with-replies flag.
 */

import { cli, Strategy } from '../../registry.js';
import { AuthRequiredError, EmptyResultError } from '../../errors.js';
import { parseNoteId, buildNoteUrl } from './note-helpers.js';

cli({
  site: 'xiaohongshu',
  name: 'comments',
  description: '获取小红书笔记评论（支持楼中楼子回复）',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'note-id', required: true, positional: true, help: 'Note ID or full /explore/<id> URL' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of top-level comments (max 50)' },
    { name: 'with-replies', type: 'boolean', default: false, help: 'Include nested replies (楼中楼)' },
  ],
  columns: ['rank', 'author', 'text', 'likes', 'time', 'is_reply', 'reply_to'],
  func: async (page, kwargs) => {
    const limit = Math.min(Number(kwargs.limit) || 20, 50);
    const withReplies = Boolean(kwargs['with-replies']);
    const raw = String(kwargs['note-id']);
    const noteId = parseNoteId(raw);

    await page.goto(buildNoteUrl(raw));
    await page.wait(3);

    const data = await page.evaluate(`
      (async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms))
        const withReplies = ${withReplies}

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
        const parseLikes = (el) => {
          const raw = clean(el)
          return /^\\d+$/.test(raw) ? Number(raw) : 0
        }

        const results = []
        const parents = document.querySelectorAll('.parent-comment')
        for (const p of parents) {
          const item = p.querySelector('.comment-item')
          if (!item) continue

          const author = clean(item.querySelector('.author-wrapper .name, .user-name'))
          const text = clean(item.querySelector('.content, .note-text'))
          const likes = parseLikes(item.querySelector('.count'))
          const time = clean(item.querySelector('.date, .time'))

          if (!text) continue
          results.push({ author, text, likes, time, is_reply: false, reply_to: '' })

          // Extract nested replies (楼中楼)
          if (withReplies) {
            p.querySelectorAll('.reply-container .comment-item-sub, .sub-comment-list .comment-item').forEach(sub => {
              const sAuthor = clean(sub.querySelector('.name, .user-name'))
              const sText = clean(sub.querySelector('.content, .note-text'))
              const sLikes = parseLikes(sub.querySelector('.count'))
              const sTime = clean(sub.querySelector('.date, .time'))
              if (!sText) return
              results.push({ author: sAuthor, text: sText, likes: sLikes, time: sTime, is_reply: true, reply_to: author })
            })
          }
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

    const all: any[] = (data as any).results ?? [];

    // When limiting, count only top-level comments; their replies are included for free
    if (withReplies) {
      const limited: any[] = [];
      let topCount = 0;
      for (const c of all) {
        if (!c.is_reply) topCount++;
        if (topCount > limit) break;
        limited.push(c);
      }
      return limited.map((c: any, i: number) => ({ rank: i + 1, ...c }));
    }

    return all.slice(0, limit).map((c: any, i: number) => ({ rank: i + 1, ...c }));
  },
});
