/**
 * Shared helpers for the IT之家 (IThome) adapter.
 *
 * IT之家 (ithome.com) is a major Chinese tech-news site. It exposes a clean,
 * UTF-8, **public JSON API** at `api.ithome.com/json/newslist/<channel>` (no
 * login, cookies or signature) for both the latest-news lists and the 热榜
 * ranking boards, and serves full article pages as plain SSR HTML at
 * `www.ithome.com/0/<dir>/<id>.htm`.
 *
 * So every command here is a PUBLIC `fetch()`:
 *   news    api.ithome.com/json/newslist/<channel>  → latest list (JSON)
 *   rank    api.ithome.com/json/newslist/rank       → 4 热榜 boards (JSON)
 *   article www.ithome.com/0/<dir>/<id>.htm          → full text (HTML)
 *
 * Keyword search and the comment 热评 stream are intentionally NOT included:
 * the search host `so.ithome.com` is DNS-sinkholed in this environment, and the
 * comment list (`cmt.ithome.com/api/webcomment/getnewscomment`) is keyed by an
 * undocumented per-article `sn` hash that isn't on the page. Neither is
 * login-gated — they're just not cleanly fetchable.
 */

import {
    ArgumentError,
    CommandExecutionError,
} from '@jackwener/opencli/errors';

export const IH_API = 'https://api.ithome.com';
export const IH_WWW = 'https://www.ithome.com';

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const NEWS_COLUMNS = ['rank', 'newsid', 'title', 'comments', 'hits', 'date', 'url'];
export const RANK_COLUMNS = ['board', 'rank', 'newsid', 'title', 'hits', 'comments', 'url'];
export const ARTICLE_COLUMNS = ['field', 'value'];

/** 热榜 board key → 中文 label (the keys returned by /json/newslist/rank). */
export const RANK_BOARDS = {
    channel48rank: '48小时热榜',
    channelweekhotrank: '周热门',
    channelweekcommentrank: '周评论榜',
    channelmonthrank: '月榜',
};

const ENTITY_MAP = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

/** Decode HTML entities (numeric + the common named ones). */
export function decodeEntities(s) {
    if (!s) return '';
    return String(s)
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (m) => ENTITY_MAP[m] || m);
}

/** Strip HTML tags (turning <br> into a separator), decode entities, collapse ws. */
export function stripHtml(html) {
    if (!html) return '';
    return decodeEntities(
        String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '),
    ).replace(/\s+/g, ' ').trim();
}

/** Collapse whitespace and trim; returns '' for nullish. */
export function clean(s) {
    return decodeEntities(String(s == null ? '' : s)).replace(/\s+/g, ' ').trim();
}

/** Validate an integer limit in [1, max]. */
export function requireLimit(value, def, max) {
    const raw = value == null || value === '' ? def : value;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`limit must be an integer between 1 and ${max}`);
    }
    return n;
}

/** "2026-06-24T17:22:21.723" → "2026-06-24 17:22" (passes through other shapes). */
export function fmtDateTime(s) {
    const str = clean(s);
    const m = str.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    return m ? `${m[1]} ${m[2]}` : (str || null);
}

/** Absolutize an IT之家 article path (`/0/968/068.htm`) onto www.ithome.com. */
export function articleUrl(path) {
    const p = clean(path);
    if (!p) return null;
    if (/^https?:/.test(p)) return p;
    return `${IH_WWW}${p.startsWith('/') ? '' : '/'}${p}`;
}

/**
 * Normalize an article reference into `{ newsid, url }`.
 *
 * Accepts a full/partial article URL (`www.ithome.com/0/968/068.htm`) or a bare
 * newsid (`968068`). The id maps to the path `/0/<floor(id/1000)>/<id%1000>.htm`
 * (e.g. 968068 → /0/968/068.htm), matching the `url` field in the news JSON.
 */
export function normalizeArticle(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) throw new ArgumentError('article must be a non-empty value');
    const urlMatch = raw.match(/\/0\/(\d+)\/(\d+)\.htm/);
    if (urlMatch) {
        const newsid = `${urlMatch[1]}${urlMatch[2]}`;
        return { newsid, url: `${IH_WWW}/0/${urlMatch[1]}/${urlMatch[2]}.htm` };
    }
    if (/^\d{4,}$/.test(raw)) {
        const n = Number(raw);
        const dir = Math.floor(n / 1000);
        const id = String(n % 1000).padStart(3, '0');
        return { newsid: raw, url: `${IH_WWW}/0/${dir}/${id}.htm` };
    }
    throw new ArgumentError(
        `'${rawInput}' does not look like an IT之家 newsid or article URL `
        + '(expected a number, or www.ithome.com/0/<dir>/<id>.htm)',
    );
}

async function ihFetch(url, contextHint, asJson) {
    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                'User-Agent': UA,
                Referer: `${IH_WWW}/`,
                'Accept-Language': 'zh-CN,zh;q=0.9',
            },
        });
    } catch (err) {
        throw new CommandExecutionError(`ithome ${contextHint} network error: ${err?.message || err}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`ithome ${contextHint} HTTP ${resp.status}`);
    }
    try {
        return asJson ? await resp.json() : await resp.text();
    } catch (err) {
        throw new CommandExecutionError(`ithome ${contextHint} bad ${asJson ? 'JSON' : 'body'}: ${err?.message || err}`);
    }
}

/** Fetch an IT之家 JSON API endpoint and return the parsed object. */
export function ihFetchJson(url, contextHint) {
    return ihFetch(url, contextHint, true);
}

/** Fetch an IT之家 HTML page (UTF-8) and return the text. */
export function ihFetchHtml(url, contextHint) {
    return ihFetch(url, contextHint, false);
}
