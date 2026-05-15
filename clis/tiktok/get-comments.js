/**
 * TikTok get-comments — return comments with reply-able IDs.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    BROWSER_HELPERS,
    TIKTOK_AID,
    parseTikTokVideoUrl,
    requireLimit,
    throwTikTokPageContextError,
} from './utils.js';

export function buildTikTokCommentsScript(videoId, limit) {
    return `(async () => {
      ${BROWSER_HELPERS}
      const videoId = ${JSON.stringify(videoId)};
      const limit = ${limit};
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const visibleText = cleanText(document.body?.innerText || '', 2000);
      if (/log in to comment|captcha|verify to continue/i.test(visibleText)) {
        throw new Error('AUTH_REQUIRED: TikTok comments require login or captcha verification');
      }

      function normalizeComment(c, index) {
        if (!c || typeof c !== 'object') return null;
        const user = c.user || c.user_info || {};
        const cid = String(c.cid || c.comment_id || c.id || '').trim();
        if (!cid) return null;
        return {
          rank: index + 1,
          comment_id: cid,
          author: cleanText(user.unique_id || user.uniqueId || user.nickname || user.nickName || '', 80),
          text: cleanText(c.text || c.content || c.comment_text || '', 300),
          likes: asNumber(c.digg_count ?? c.like_count ?? c.likeCount) ?? 0,
          replies_count: asNumber(c.reply_comment_total ?? c.reply_count ?? c.replyCommentTotal) ?? 0,
          time: c.create_time ? new Date(Number(c.create_time) * 1000).toISOString().replace('T', ' ').substring(0, 19) : '',
        };
      }

      try {
        const params = new URLSearchParams({
          aweme_id: videoId,
          cursor: '0',
          count: String(limit),
          aid: ${JSON.stringify(TIKTOK_AID)},
        });
        const data = await fetchJson('/api/comment/list/?' + params.toString());
        assertTikTokApiSuccess(data, 'comment-list');
        const comments = Array.isArray(data.comments) ? data.comments : [];
        const rows = comments.map(normalizeComment).filter(Boolean).slice(0, limit);
        if (rows.length > 0) return rows.map((row, i) => ({ ...row, rank: i + 1 }));
      } catch (error) {
        if (/AUTH_REQUIRED/i.test(String(error?.message || error))) throw error;
      }

      const openCommentPanel = async () => {
        const selectors = [
          '[data-e2e="comment-icon"]',
          '[data-e2e="browse-comment"]',
          '[aria-label*="comment" i]',
          '[aria-label*="评论"]',
        ];
        for (const selector of selectors) {
          const target = document.querySelector(selector);
          if (!target) continue;
          const clickable = target.closest('button, [role="button"], a') || target;
          clickable.click();
          await wait(2500);
          break;
        }
      };
      await openCommentPanel();

      const roots = Array.from(document.querySelectorAll([
        '[data-e2e="comment-level-1"]',
        '[data-e2e^="comment-level-"]',
        '[data-e2e="search-comment-container"]',
        '[class*="CommentItem"]',
      ].join(',')));
      const seen = new Set();
      const rows = [];
      for (const root of roots) {
        const container = root.closest('[data-e2e*="comment"], [class*="Comment"], li, div') || root;
        const html = container.outerHTML || '';
        const attrText = Array.from(container.querySelectorAll('*')).slice(0, 50)
          .flatMap(el => Array.from(el.attributes || []).map(attr => attr.value)).join(' ');
        const idMatch = (html + ' ' + attrText).match(/(?:cid|comment[_-]?id|commentId)[^0-9]{0,12}(\\d{10,})|\\b(7\\d{18,})\\b/);
        const cid = idMatch ? (idMatch[1] || idMatch[2]) : '';
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        const userEl = container.querySelector('[data-e2e*="comment-username"], a[href*="/@"]');
        const textEl = root.querySelector('p, span') || container.querySelector('[data-e2e*="comment-level"]') || root;
        const likeEl = container.querySelector('[data-e2e*="like-count"], [data-e2e*="comment-like"]');
        const text = cleanText(textEl?.textContent || '', 300);
        if (!text) continue;
        rows.push({
          rank: rows.length + 1,
          comment_id: cid,
          author: cleanText(userEl?.textContent || '', 80),
          text,
          likes: asNumber(cleanText(likeEl?.textContent || '0', 20).replace(/[^0-9.]/g, '')) ?? 0,
          replies_count: 0,
          time: '',
        });
        if (rows.length >= limit) break;
      }
      return rows;
    })()`;
}

export const command = cli({
    site: 'tiktok',
    name: 'get-comments',
    access: 'read',
    description: 'Get comments on a TikTok video with reply-able IDs',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'url', type: 'string', required: true, positional: true, help: 'TikTok video URL' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of comments to return' },
    ],
    columns: ['rank', 'comment_id', 'author', 'text', 'likes', 'replies_count', 'time'],
    func: async (page, kwargs) => {
        const parsed = parseTikTokVideoUrl(kwargs.url);
        const limit = requireLimit(kwargs.limit, { fallback: 20, max: 50 });
        await page.goto(parsed.url, { waitUntil: 'load', settleMs: 6000 });
        try {
            const rows = await page.evaluate(buildTikTokCommentsScript(parsed.videoId, limit));
            if (!Array.isArray(rows) || rows.length === 0) {
                throw new EmptyResultError('tiktok/get-comments', `No comments found for video ${parsed.videoId}`);
            }
            return rows;
        }
        catch (error) {
            throwTikTokPageContextError(error, {
                authMessage: 'TikTok comments require a logged-in browser session or captcha verification',
                emptyPattern: /No comments found|returned no data/i,
                emptyTarget: 'tiktok/get-comments',
                failureMessage: 'TikTok comments read failed',
            });
        }
    },
});

export const __test__ = {
    buildTikTokCommentsScript,
};
