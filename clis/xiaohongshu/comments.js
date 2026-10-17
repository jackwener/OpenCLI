/**
 * Xiaohongshu comments — DOM extraction from note detail page.
 * XHS API requires signed requests, so we scrape the rendered DOM instead.
 *
 * Supports both top-level comments and nested replies (楼中楼) via
 * the --with-replies flag.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseNoteId, buildNoteUrl } from './note-helpers.js';
import { readXhsDetailPage } from './risk-control.js';

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
 * The note's total comment count as the page states it: the comments header
 * ("共 3528 条评论") when rendered, else the interaction-bar count ("1.2万").
 * The bar's zero-count placeholder ("评论") and "暂无评论" are 0. Anything
 * unrecognised is null (unknown), never 0 — a misread 0 would skip the
 * comment scroll and pass an empty load off as "no comments". Self-contained
 * apart from parseXhsLikeCountText, since both are injected into the
 * page-side extractor.
 */
export function parseXhsCommentTotal(headerText, barText) {
    // parseXhsLikeCountText reads any shape it does not know as 0; only a
    // literal zero may become 0 here.
    const count = (raw) => {
        const n = parseXhsLikeCountText(raw);
        return n === 0 && !/^0+$/.test(raw) ? null : n;
    };
    const header = String(headerText ?? '').replace(/\s+/g, '');
    const fromHeader = header.match(/共([\d,，.]+[wWkK万千]?)条评论/u);
    if (fromHeader)
        return count(fromHeader[1]);
    if (/暂无评论/u.test(header))
        return 0;
    const bar = String(barText ?? '').replace(/\s+/g, '');
    if (bar === '评论')
        return 0;
    if (!/^[\d,，.]+[wWkK万千]?\+?$/u.test(bar))
        return null;
    return count(bar);
}

/**
 * An empty comments payload is only a real "no comments" when the page agrees.
 * With zero rows: an unavailable-note page is EMPTY_RESULT, and a page that
 * states the note HAS comments means the list never loaded (background or
 * occluded window, a transient restriction, a layout change) — fail typed
 * instead of returning a success-shaped []. Comments the extractor skipped for
 * having no text (image or sticker only) account for a non-zero total.
 * Shared with the rednote adapter.
 */
export function assertCommentsLoaded(data, rowCount, commandName) {
    if (rowCount > 0)
        return;
    if (data.notFound) {
        throw new EmptyResultError(commandName, 'The note is unavailable — it may have been deleted or restricted.');
    }
    if (typeof data.commentTotal === 'number' && data.commentTotal > 0 && !(data.skippedEmpty > 0)) {
        throw new CliError(
            'COMMENTS_NOT_LOADED',
            `${commandName}: the page reports ${data.commentTotal} comments but none loaded`,
            'The comment list did not render. Keep the browser automation window visible (not minimized or covered) and retry later.',
        );
    }
}

function normalizeOptionalString(value, field, commandName) {
    if (value == null)
        return '';
    if (typeof value !== 'string') {
        throw new CommandExecutionError(`${commandName}: malformed comment row ${field}`);
    }
    return value;
}

export function normalizeCommentImages(value, commandName) {
    if (value == null)
        return [];
    if (!Array.isArray(value)) {
        throw new CommandExecutionError(`${commandName}: malformed comment row images`);
    }
    const urls = [];
    for (const raw of value) {
        if (typeof raw !== 'string') {
            throw new CommandExecutionError(`${commandName}: malformed comment row image URL`);
        }
        const trimmed = raw.trim();
        let parsed;
        try {
            parsed = new URL(trimmed);
        }
        catch {
            throw new CommandExecutionError(`${commandName}: malformed comment row image URL`);
        }
        if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) {
            throw new CommandExecutionError(`${commandName}: malformed comment row image URL`);
        }
        const href = parsed.toString();
        if (!urls.includes(href))
            urls.push(href);
    }
    return urls;
}

export function normalizeCommentRows(value, commandName = 'xiaohongshu/comments') {
    if (value == null)
        return [];
    if (!Array.isArray(value)) {
        throw new CommandExecutionError(`${commandName}: malformed comments payload`);
    }
    return value.map((row, index) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new CommandExecutionError(`${commandName}: malformed comment row at index ${index}`);
        }
        const text = normalizeOptionalString(row.text, 'text', commandName);
        if (!text) {
            throw new CommandExecutionError(`${commandName}: malformed comment row text`);
        }
        const likes = Number(row.likes);
        if (!Number.isInteger(likes) || likes < 0) {
            throw new CommandExecutionError(`${commandName}: malformed comment row likes`);
        }
        if (typeof row.is_reply !== 'boolean') {
            throw new CommandExecutionError(`${commandName}: malformed comment row is_reply`);
        }
        return {
            author: normalizeOptionalString(row.author, 'author', commandName),
            authorHrefRaw: normalizeOptionalString(row.authorHrefRaw, 'authorHrefRaw', commandName),
            text,
            likes,
            time: normalizeOptionalString(row.time, 'time', commandName),
            is_reply: row.is_reply,
            reply_to: normalizeOptionalString(row.reply_to, 'reply_to', commandName),
            images: normalizeCommentImages(row.images, commandName),
        };
    });
}

/**
 * Host-agnostic IIFE that scrolls a note's comment list and extracts
 * top-level comments (and optionally nested 楼中楼 replies). Exported so
 * the rednote adapter can reuse the exact same selector chain.
 */
export function buildCommentsExtractJs(withReplies, limit = 20) {
    return `
      (async () => {
        const wait = (ms) => new Promise(r => setTimeout(r, ms))
        const withReplies = ${withReplies}
        const limitCount = ${Number(limit) || 20}
        ${parseXhsLikeCountText.toString()}
        ${parseXhsCommentTotal.toString()}
        const readCommentTotal = () => parseXhsCommentTotal(
          document.querySelector('.comments-container .total')?.textContent,
          document.querySelector('.interact-container .chat-wrapper .count')?.textContent,
        )

        // Check login state
        const bodyText = document.body?.innerText || ''
        const loginWall = /登录后查看|请登录/.test(bodyText)
        // Only a page without the note panel or any comment counts as unavailable:
        // the same words can appear inside a real note's text or its comments.
        const notFound = /页面不见了|笔记不存在|无法浏览/.test(bodyText)
          && !document.querySelector('#noteContainer, .parent-comment')
        const securityBlock = /安全限制|访问链接异常/.test(bodyText)
          || /website-login\\/error|error_code=300017|error_code=300031/.test(location.href)
        // No scrolling on a page that cannot have a comment list (unavailable,
        // blocked, login wall) or that says the note has no comments. Loading
        // is done once --limit is reached or every comment the page states is
        // loaded, whichever comes first.
        const initialTotal = readCommentTotal()
        const skipScroll = notFound || securityBlock || loginWall || initialTotal === 0
        const loadedEnough = (count) => count >= limitCount || (initialTotal !== null && count >= initialTotal)

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
          for (let i = 0; i < 60 && !skipScroll; i++) {
            const beforeCount = document.querySelectorAll('.parent-comment').length
            if (loadedEnough(beforeCount)) break
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
        const parseLikeCountText = parseXhsLikeCountText
        const parseLikes = (el) => {
          return parseLikeCountText(clean(el))
        }
        const HREF_SELECTOR = ${JSON.stringify(XHS_PROFILE_HREF_SELECTOR)}
        const extractAuthorHref = (el) => {
          if (!el) return ''
          const anchor = el.querySelector(HREF_SELECTOR)
          return anchor ? (anchor.getAttribute('href') || '') : ''
        }
        // Attached comment photos, excluding avatars, inline emoji, badges, and
        // other UI images. Only images inside comment/reply media containers are
        // projected as media evidence.
        const extractImages = (el) => {
          if (!el) return []
          const urls = []
          el.querySelectorAll('img').forEach(img => {
            if (img.classList.contains('avatar-item')) return
            if (img.closest('.content, .note-text')) return
            if (!img.closest('.comment-pic, .reply-pic, .comment-image, .reply-image, .comment-img, .reply-img, [class*="comment-pic"], [class*="reply-pic"], [class*="comment-image"], [class*="reply-image"]')) return
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
        let skippedEmpty = 0
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

          if (!text) {
            // Empty skeletons are not evidence that comments have loaded.
            // Only rendered media/stickers explain a textless comment.
            if (images.length > 0 || item.querySelector('.content img[src], .note-text img[src]')) skippedEmpty++
            continue
          }
          results.push({ author, authorHrefRaw, text, likes, time, is_reply: false, reply_to: '', images })

          // Extract nested replies (楼中楼)
          if (withReplies) {
            await expandReplyThreads(p)
            p.querySelectorAll('.reply-container .comment-item-sub, .sub-comment-list .comment-item').forEach(sub => {
              const sAuthor = clean(sub.querySelector('.name, .user-name'))
              const sAuthorHrefRaw = extractAuthorHref(sub)
              const sContent = sub.querySelector('.content, .note-text')
              const sText = clean(sContent)
              // Xiaohongshu renders the direct target only for reply-to-reply
              // rows (回复 <span class="nickname">Bob</span> : ...). A nested
              // row without that marker is a direct reply to the thread root.
              const sReplyTo = clean(sContent?.querySelector(':scope > .nickname')) || author
              const sLikes = parseLikes(sub.querySelector('.count'))
              const sTime = clean(sub.querySelector('.date, .time'))
              const sImages = extractImages(sub)
              if (!sText) return
              results.push({ author: sAuthor, authorHrefRaw: sAuthorHrefRaw, text: sText, likes: sLikes, time: sTime, is_reply: true, reply_to: sReplyTo, images: sImages })
            })
          }
        }

        const commentTotal = readCommentTotal() ?? initialTotal
        return { pageUrl: location.href, securityBlock, loginWall, notFound, commentTotal, skippedEmpty, results }
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
        { name: 'with-replies', type: 'boolean', default: false, help: 'Include nested replies; reply_to is the direct target shown by the page' },
    ],
    columns: ['rank', 'author', 'userId', 'profileUrl', 'text', 'likes', 'time', 'is_reply', 'reply_to', 'images'],
    func: async (page, kwargs) => {
        const limit = parseCommentLimit(kwargs.limit);
        const withReplies = Boolean(kwargs['with-replies']);
        const raw = String(kwargs['note-id']);
        const noteId = parseNoteId(raw);
        // readXhsDetailPage paces the navigation and retries once through a
        // cooldown if risk control soft-blocks the page (throws SECURITY_BLOCK
        // when still blocked after the retry).
        const data = await readXhsDetailPage(page, {
            url: buildNoteUrl(raw, { commandName: 'xiaohongshu comments' }),
            extractJs: buildCommentsExtractJs(withReplies, limit),
            securityHelp: /^https?:\/\//.test(raw)
                ? 'The page may be temporarily restricted. Try again later or from a different session.'
                : 'Try using a full URL from search results (with xsec_token) instead of a bare note ID.',
        });
        if (!data || typeof data !== 'object') {
            throw new EmptyResultError('xiaohongshu/comments', 'Unexpected evaluate response');
        }
        if (data.loginWall) {
            throw new AuthRequiredError('www.xiaohongshu.com', 'Note comments require login');
        }
        // noteId currently unused after parsing — kept for symmetry with the note command
        void noteId;
        const all = normalizeCommentRows(data.results, 'xiaohongshu/comments');
        assertCommentsLoaded(data, all.length, 'xiaohongshu/comments');
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
