/**
 * Xiaohongshu comments — DOM extraction from note detail page.
 * XHS API requires signed requests, so we scrape the rendered DOM instead.
 *
 * Supports both top-level comments and nested replies (楼中楼) via
 * the --with-replies flag.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseNoteId, buildNoteUrl } from './note-helpers.js';

const XHS_PROFILE_HREF_SELECTOR = '.author-wrapper a[href*="/user/profile/"], a.name[href*="/user/profile/"], a.user-name[href*="/user/profile/"], a[href*="/user/profile/"]';

export function parseXhsProfileHref(href, webHost = 'www.xiaohongshu.com') {
    const raw = typeof href === 'string' ? href.trim() : '';
    if (!raw)
        return '';
    const expectedHost = String(webHost || 'www.xiaohongshu.com').toLowerCase();
    let parsed;
    try {
        parsed = new URL(raw, `https://${expectedHost}`);
    }
    catch {
        return '';
    }
    if (parsed.protocol !== 'https:')
        return '';
    const host = parsed.hostname.toLowerCase();
    if (host !== expectedHost)
        return '';
    const match = parsed.pathname.match(/^\/user\/profile\/([a-zA-Z0-9]+)\/?$/);
    return match?.[1] ?? '';
}

export function buildXhsProfileUrl(href, webHost = 'www.xiaohongshu.com') {
    const userId = parseXhsProfileHref(href, webHost);
    if (!userId)
        return '';
    return `https://${webHost}/user/profile/${userId}`;
}
export function parseCommentLimit(raw, fallback = 20) {
    const n = Number(raw);
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(1, Math.min(Math.floor(n), 50));
}

export function parseXhsLikeCountText(value) {
    const integerRe = /^(?:\d+|\d{1,3}(?:[,，]\d{3})+)\+?$/u;
    const shortformRe = /^((?:\d+|\d{1,3}(?:[,，]\d{3})+)(?:\.\d+)?)([wWkK万千])\+?$/u;
    const raw = String(value ?? '').replace(/\s+/g, '');
    if (!raw)
        return 0;
    if (integerRe.test(raw))
        return Number(raw.replace(/[,+，]/g, ''));
    const short = raw.match(shortformRe);
    if (!short)
        return 0;
    const numeric = Number(short[1].replace(/[,，]/g, ''));
    if (!Number.isFinite(numeric))
        return 0;
    const unit = short[2].toLowerCase();
    const multiplier = unit === 'w' || unit === '万' ? 10000 : 1000;
    return Math.round(numeric * multiplier);
}

/**
 * Host-agnostic IIFE that scrolls a note's comment list and extracts
 * top-level comments (and optionally nested 楼中楼 replies). Exported so
 * the rednote adapter can reuse the exact same selector chain.
 */
export function buildCommentsExtractJs(withReplies, limit = 20) {
    const parseLikeCountText = parseXhsLikeCountText.toString();
    return `
      (async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms))
        const withReplies = ${withReplies}
        const targetCount = ${Number(limit) || 20}

        // Check login state
        const bodyText = document.body?.innerText || ''
        const loginWall = /登录后查看|请登录/.test(bodyText)
        const securityBlock = /安全限制|访问链接异常/.test(bodyText)
          || /website-login\\/error|error_code=300017|error_code=300031/.test(location.href)

        // Scroll to trigger comment loading. Xiaohongshu loads comments in
        // small async batches via IntersectionObserver, and depending on the
        // page layout / viewport the actual scrollable ancestor can be
        // .note-scroller, .container, or the document itself — so each round
        // drives all of them plus scrollIntoView on the last loaded comment,
        // which works regardless of which element actually owns the scrollbar.
        // A single stalled round doesn't mean the list is exhausted — keep
        // going until growth stalls for several consecutive rounds, we've
        // loaded enough top-level comments to satisfy --limit, or we hit the
        // hard round cap.
        const scroller = document.querySelector('.note-scroller') || document.querySelector('.container')
        const driveScroll = () => {
          if (scroller) scroller.scrollTo(0, scroller.scrollHeight)
          const comments = document.querySelectorAll('.parent-comment')
          const last = comments[comments.length - 1]
          if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'end' })
          if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
            window.scrollTo(0, document.body.scrollHeight)
          }
        }
        {
          let stall = 0
          for (let i = 0; i < 60; i++) {
            const beforeCount = document.querySelectorAll('.parent-comment').length
            if (beforeCount >= targetCount) break
            driveScroll()
            await wait(1000 + Math.random() * 1200)
            const afterCount = document.querySelectorAll('.parent-comment').length
            if (afterCount <= beforeCount) {
              stall++
              if (stall >= 6) break
            } else {
              stall = 0
            }
          }
        }

        const clean = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim()
        const parseLikeCountText = ${parseLikeCountText}
        const parseLikes = (el) => {
          return parseLikeCountText(clean(el))
        }
        const HREF_SELECTOR = ${JSON.stringify(XHS_PROFILE_HREF_SELECTOR)}
        const extractAuthorHref = (el) => {
          if (!el) return ''
          const anchor = el.querySelector(HREF_SELECTOR)
          return anchor ? (anchor.getAttribute('href') || '') : ''
        }
        // Attached comment photos, excluding the author avatar and inline
        // note-content-emoji stickers rendered inside the comment text.
        const extractImages = (el) => {
          if (!el) return []
          const urls = []
          el.querySelectorAll('img').forEach(img => {
            if (img.classList.contains('avatar-item')) return
            if (img.closest('.content, .note-text')) return
            const src = img.currentSrc || img.src || img.getAttribute('data-src') || ''
            if (src && !urls.includes(src)) urls.push(src)
          })
          return urls
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
              await wait(200 + Math.random() * 300)
            }
          }
        }

        const results = []
        const parents = document.querySelectorAll('.parent-comment')
        for (const p of parents) {
          const item = p.querySelector('.comment-item')
          if (!item) continue

          const author = clean(item.querySelector('.author-wrapper .name, .user-name'))
          const authorHrefRaw = extractAuthorHref(item)
          const text = clean(item.querySelector('.content, .note-text'))
          const likes = parseLikes(item.querySelector('.count'))
          const time = clean(item.querySelector('.date, .time'))
          const images = extractImages(item)

          if (!text) continue
          results.push({ author, authorHrefRaw, text, likes, time, is_reply: false, reply_to: '', images })

          // Extract nested replies (楼中楼)
          if (withReplies) {
            await expandReplyThreads(p)
            p.querySelectorAll('.reply-container .comment-item-sub, .sub-comment-list .comment-item').forEach(sub => {
              const sAuthor = clean(sub.querySelector('.name, .user-name'))
              const sAuthorHrefRaw = extractAuthorHref(sub)
              const sText = clean(sub.querySelector('.content, .note-text'))
              const sLikes = parseLikes(sub.querySelector('.count'))
              const sTime = clean(sub.querySelector('.date, .time'))
              const sImages = extractImages(sub)
              if (!sText) return
              results.push({ author: sAuthor, authorHrefRaw: sAuthorHrefRaw, text: sText, likes: sLikes, time: sTime, is_reply: true, reply_to: author, images: sImages })
            })
          }
        }

        return { pageUrl: location.href, securityBlock, loginWall, results }
      })()
    `;
}
export const command = cli({
    site: 'xiaohongshu',
    name: 'comments',
    access: 'read',
    description: '获取小红书笔记评论（支持楼中楼子回复）',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'note-id', required: true, positional: true, help: 'Full Xiaohongshu note URL with xsec_token' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of top-level comments (max 50)' },
        { name: 'with-replies', type: 'boolean', default: false, help: 'Include nested replies (楼中楼)' },
    ],
    columns: ['rank', 'author', 'userId', 'profileUrl', 'text', 'likes', 'time', 'is_reply', 'reply_to', 'images'],
    func: async (page, kwargs) => {
        const limit = parseCommentLimit(kwargs.limit);
        const withReplies = Boolean(kwargs['with-replies']);
        const raw = String(kwargs['note-id']);
        const noteId = parseNoteId(raw);
        await page.goto(buildNoteUrl(raw, { commandName: 'xiaohongshu comments' }));
        await page.wait({ time: 2 + Math.random() * 3 });
        const data = await page.evaluate(buildCommentsExtractJs(withReplies, limit));
        if (!data || typeof data !== 'object') {
            throw new EmptyResultError('xiaohongshu/comments', 'Unexpected evaluate response');
        }
        if (data.securityBlock) {
            throw new CliError('SECURITY_BLOCK', 'Xiaohongshu security block: the note detail page was blocked by risk control.', /^https?:\/\//.test(raw)
                ? 'The page may be temporarily restricted. Try again later or from a different session.'
                : 'Try using a full URL from search results (with xsec_token) instead of a bare note ID.');
        }
        if (data.loginWall) {
            throw new AuthRequiredError('www.xiaohongshu.com', 'Note comments require login');
        }
        // noteId currently unused after parsing — kept for symmetry with the note command
        void noteId;
        const all = data.results ?? [];
        // authorHrefRaw is a raw transport field from the extractor; it is consumed
        // here into userId / profileUrl and intentionally not part of the row shape.
        const enrich = (c, i) => ({
            rank: i + 1,
            author: c.author,
            userId: c.authorHrefRaw ? parseXhsProfileHref(c.authorHrefRaw) : '',
            profileUrl: c.authorHrefRaw ? buildXhsProfileUrl(c.authorHrefRaw) : '',
            text: c.text,
            likes: c.likes,
            time: c.time,
            is_reply: c.is_reply,
            reply_to: c.reply_to,
            images: c.images ?? [],
        });
        // When limiting, count only top-level comments; their replies are included for free
        if (withReplies) {
            const limited = [];
            let topCount = 0;
            for (const c of all) {
                if (!c.is_reply)
                    topCount++;
                if (topCount > limit)
                    break;
                limited.push(c);
            }
            return limited.map(enrich);
        }
        return all.slice(0, limit).map(enrich);
    },
});
