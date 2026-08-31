/**
 * Shared helpers for jiuyangongshe.com adapters.
 *
 * The site is a Nuxt SSR application. Every public page renders an HTML
 * document that embeds the full SSR data graph inside the
 * `window.__NUXT__=(function(){return {...}})()` block at the bottom of the
 * document. We extract that single JavaScript assignment, evaluate it in a
 * side-effect-free scope, and obtain a normalized object that closely mirrors
 * what the front-end uses.
 *
 * Top-level shape returned by the IIFE (after eval):
 *   {
 *     data: [ { list: [...], searchData: {...}, category: [...] }, ... ],
 *     state: { rankList: { hot_search_list, hot_article_list, hot_user_list } },
 *     layout, fetch, error, serverRendered, routePath, config, ...
 *   }
 *
 * Field shape per article item in `data[].list`:
 *   { article_id, title, content, user: { nickname, user_id, avatar, style_str },
 *     stock_list: [{ name, code }], comment_count, like_count, collect_count,
 *     forward_count, step_count, integral, create_time, sync_time,
 *     new_interaction_time, is_top, categoryIdSet, ... }
 *
 * The eval is sandboxed inside a fresh `Function(...)` so the payload cannot
 * touch the host module's globals. The source code itself comes from the
 * public HTML response (server-controlled), not user input.
 */
import { CliError } from '@jackwener/opencli/errors';
import { extractNuxtPayload as _extractNuxtPayloadShared, fetchText as _fetchTextShared } from '../_shared/ssrPayload.js';

// Map the shared SSR_* error codes back to the legacy JYS_* codes that
// existing callers downstream expect. The shared module names are
// site-neutral so future adapters can reuse without depending on a
// jiuyangongshe namespace.
const SSR_CODE_TO_JYS = {
    SSR_PAYLOAD_MISSING: 'JYS_PAYLOAD_MISSING',
    SSR_PAYLOAD_PARSE:   'JYS_PAYLOAD_PARSE',
    SSR_PAYLOAD_EVAL:    'JYS_PAYLOAD_EVAL',
    HTTP_ERROR:          'JYS_HTTP_ERROR',
    TIMEOUT_ERR:         'JYS_TIMEOUT',
    COMMAND_EXEC:        'JYS_NETWORK',
};

function _relabel(err) {
    const code = SSR_CODE_TO_JYS[err?.code];
    if (!code) throw err;
    throw new CliError(code, err.message, err.hint, err.exitCode);
}

/**
 * Site-scoped wrapper around the shared `extractNuxtPayload` so existing
 * jiuyangongshe adapter imports (which used `JYS_PAYLOAD_*` codes) continue
 * working without change.
 *
 * @param {string} html
 * @returns {object}
 */
export function extractNuxtPayload(html) {
    try {
        return _extractNuxtPayloadShared(html);
    } catch (err) {
        _relabel(err);
    }
}

/**
 * Site-scoped wrapper around the shared `fetchText`. Same JYS_* code
 * preservation as `extractNuxtPayload`.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchPage(url) {
    try {
        return await _fetchTextShared(url, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
                    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9',
            },
        });
    } catch (err) {
        _relabel(err);
    }
}

/**
 * Normalize an A-share ticker code by stripping common exchange prefixes
 * and trimming whitespace. The site's `stock_list[].code` field uses two
 * shapes:
 *   - Prefixed:  `sh600519`, `sz002156` (case-insensitive exchange tag)
 *   - Raw:       `01688`, `600519` (no prefix, e.g. Hong Kong ADRs or
 *                HK-listed mainland tickers)
 *
 * The helper preserves the original digits so callers can match against
 * either representation. Output is always lowercased and unprefixed.
 *
 * @param {string} code Raw ticker code from the SSR payload or user input.
 * @returns {string} Normalized code (digits only, no exchange prefix).
 */
export function normalizeTickerCode(code) {
    if (typeof code !== 'string') return '';
    return code.trim().toLowerCase().replace(/^(sh|sz|sh\.|sz\.)/, '');
}

/** Decode the small set of HTML entities Nuxt emits in titles/strings. */
function decodeHtmlEntities(str) {
    if (typeof str !== 'string') return str;
    return str
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
}

/** Strip tags from the post body, preserving paragraph breaks. */
function stripHtml(html) {
    if (!html) return '';
    return String(html)
        .replace(/<img[^>]*>/gi, '')
        .replace(/<span[^>]*class="[^"]*\bsource-search\b[^"]*"[^>]*>/gi, '')
        .replace(/<\/span>/gi, '')
        .replace(/<\/(p|div|br|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Pull the article list from the first data entry that contains one. */
export function extractArticleList(payload) {
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    for (const entry of entries) {
        if (entry && Array.isArray(entry.list)) return entry.list;
    }
    return [];
}


/** Pull the category sidebar data from a payload. */
export function extractCategoryList(payload) {
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    for (const entry of entries) {
        if (entry && Array.isArray(entry.category)) return entry.category;
    }
    return [];
}

/** Rank-list block from the page state (hot search keywords, hot articles, hot users). */
export function extractRankList(payload) {
    const state = payload?.state;
    return state && typeof state === 'object' ? state.rankList || null : null;
}

/**
 * Shape an article item into the canonical row schema shared by hot / search /
 * latest. Tickers are rendered as `name(code)` so reviewers can see the
 * attached A-share symbols at a glance.
 */
export function shapeArticleRow(item, index) {
    if (!item) return null;
    const author = item.user?.nickname ?? null;
    const summary = stripHtml(item.content ?? '').slice(0, 200);
    const tickers = Array.isArray(item.stock_list)
        ? item.stock_list.map((s) => {
            const name = s && typeof s.name === 'string' ? s.name : '';
            const code = s && typeof s.code === 'string' ? s.code : '';
            return code ? `${name}(${code})` : name;
        }).filter(Boolean)
        : [];
    return {
        rank: index + 1,
        id: item.article_id ?? null,
        title: decodeHtmlEntities(item.title ?? ''),
        author,
        authorId: item.user?.user_id ?? null,
        publishedAt: item.create_time ?? null,
        updatedAt: item.sync_time ?? null,
        lastInteractionAt: item.new_interaction_time ?? null,
        summary,
        tags: Array.isArray(item.categoryIdSet) ? item.categoryIdSet.map(String) : [],
        isTop: Boolean(item.is_top),
        views: typeof item.step_count === 'number' ? item.step_count : null,
        comments: typeof item.comment_count === 'number' ? item.comment_count : null,
        likes: typeof item.like_count === 'number' ? item.like_count : null,
        collects: typeof item.collect_count === 'number' ? item.collect_count : null,
        forwards: typeof item.forward_count === 'number' ? item.forward_count : null,
        integral: typeof item.integral === 'number' ? item.integral : null,
        tickers,
        url: item.article_id ? `https://www.jiuyangongshe.com/a/${item.article_id}` : null,
    };
}

/** Build a single detail row from a standalone article payload (used by `detail`). */
export function shapeDetailRow(item) {
    if (!item) return null;
    const body = stripHtml(item.content ?? '');
    const tickers = Array.isArray(item.stock_list)
        ? item.stock_list.map((s) => {
            const name = s && typeof s.name === 'string' ? s.name : '';
            const code = s && typeof s.code === 'string' ? s.code : '';
            return code ? `${name}(${code})` : name;
        }).filter(Boolean)
        : [];
    return {
        id: item.article_id ?? null,
        title: decodeHtmlEntities(item.title ?? ''),
        author: item.user?.nickname ?? null,
        authorId: item.user?.user_id ?? null,
        authorStyle: item.user?.style_str ?? null,
        authorAvatar: item.user?.avatar ?? null,
        publishedAt: item.create_time ?? null,
        updatedAt: item.sync_time ?? null,
        lastInteractionAt: item.new_interaction_time ?? null,
        summary: body.slice(0, 400),
        body,
        views: typeof item.step_count === 'number' ? item.step_count : null,
        comments: typeof item.comment_count === 'number' ? item.comment_count : null,
        likes: typeof item.like_count === 'number' ? item.like_count : null,
        collects: typeof item.collect_count === 'number' ? item.collect_count : null,
        forwards: typeof item.forward_count === 'number' ? item.forward_count : null,
        integral: typeof item.integral === 'number' ? item.integral : null,
        tickers,
        tags: Array.isArray(item.categoryIdSet) ? item.categoryIdSet.map(String) : [],
        url: item.article_id ? `https://www.jiuyangongshe.com/a/${item.article_id}` : null,
    };
}
