/**
 * Xiaohongshu comments — DOM extraction from note detail page.
 * XHS API requires signed requests, so we scrape the rendered DOM instead.
 *
 * Supports both top-level comments and nested replies (楼中楼) via
 * the --with-replies flag.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseNoteId, buildNoteUrl } from './note-helpers.js';

function parseCommentLimit(raw: unknown, fallback = 20): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 50));
}

cli({
  site: 'xiaohongshu',
  name: 'comments',
  description: '获取小红书笔记评论（支持楼中楼子回复）',
  domain: 'www.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'note-id', required: true, positional: true, help: 'Note ID or full URL (preserves xsec_token for access)' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of top-level comments (max 50)' },
    { name: 'with-replies', type: 'boolean', default: false, help: 'Include nested replies (楼中楼)' },
  ],
  columns: ['rank', 'author', 'text', 'likes', 'time', 'is_reply', 'reply_to'],
  func: async (page, kwargs) => {
    const limit = parseCommentLimit(kwargs.limit);
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
        const expandReplyThreads = async (root) => {
          if (!withReplies || !root) return
          const clickedTexts = new Set()
          for (let round = 0; round < 3; round++) {
            const expanders = Array.from(root.querySelectorAll('button, [role="button"], span, div')).filter(el => {
              if (!(el instanceof HTMLElement)) return false
              const text = clean(el)
              if (!text || text.length > 24) return false
              if (!/(展开|更多回复|全部回复|查看.*回复|共\\d+条回复)/.test(text)) return false
              if (clickedTexts.has(text)) return false
              return true
            })
            if (!expanders.length) break
            for (const el of expanders) {
              const text = clean(el)
              el.click()
              clickedTexts.add(text)
              await wait(300)
            }
          }
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
            await expandReplyThreads(p)
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
