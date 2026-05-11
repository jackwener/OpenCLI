/**
 * Shared helpers for 一亩三分地 (1point3acres.com) adapters.
 *
 * Site is a Discuz!X PHP BBS that serves GBK-encoded HTML.
 * - Thread listings:  /bbs/forum.php?mod=guide&view={hot|new|digest|newthread}
 * - Forum:            /bbs/forum-<fid>-<page>.html
 * - Thread detail:    /bbs/thread-<tid>-<page>-1.html
 * - User profile:     /bbs/space-uid-<uid>.html  or  /bbs/space-username-<name>.html
 * - Search:           /bbs/search.php?mod=forum  (COOKIE — guests get an alert page)
 */
import { AuthRequiredError, ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export const BASE = 'https://www.1point3acres.com/bbs';

/**
 * Validate `limit` per typed-fail-fast convention (no silent clamp).
 * Throws ArgumentError on non-positive / non-integer / out-of-range input.
 */
export function normalizeLimit(value, defaultValue, maxValue, label = 'limit') {
    const limit = normalizePositiveInteger(value, defaultValue, label);
    if (limit > maxValue) {
        throw new ArgumentError(`${label} must be <= ${maxValue}`);
    }
    return limit;
}

/** Validate a positive integer argument without silently flooring/clamping. */
export function normalizePositiveInteger(value, defaultValue, label = 'value', { min = 1 } = {}) {
    const raw = value ?? defaultValue;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    if (limit < min) {
        throw new ArgumentError(`${label} must be >= ${min}`);
    }
    return limit;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0 Safari/537.36';

/** Fetch a GBK-encoded Discuz page and return decoded UTF-8 HTML. */
export async function fetchHtml(url, { headers = {}, cookie = '' } = {}) {
    let res;
    try {
        res = await fetch(url, {
            headers: {
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                ...(cookie ? { Cookie: cookie } : {}),
                ...headers,
            },
            redirect: 'follow',
        });
    } catch (error) {
        throw new CommandExecutionError(`1point3acres request failed: ${error?.message || error}`);
    }
    if (!res.ok) {
        throw new CommandExecutionError(`1point3acres request failed: HTTP ${res.status} ${res.statusText} from ${url}`);
    }
    const buf = await res.arrayBuffer();
    return new TextDecoder('gbk').decode(buf);
}

/** Pull cookie string from the live browser session for this domain.
 *  Discuz auth cookies (4Oaf_61d6_*, session) are HttpOnly and set on the
 *  root domain `.1point3acres.com`, so we need `getCookies` (not document.cookie)
 *  AND we need to query both host + root domain and merge.
 */
export async function getCookie(page) {
    if (!page) return '';
    const seen = new Map();
    if (typeof page.getCookies === 'function') {
        for (const opts of [{ domain: 'www.1point3acres.com' }, { domain: '.1point3acres.com' }]) {
            try {
                const cookies = await page.getCookies(opts);
                for (const c of cookies || []) {
                    if (!seen.has(c.name)) seen.set(c.name, c.value);
                }
            } catch { /* try next */ }
        }
    }
    if (seen.size > 0) {
        return [...seen].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    try {
        const result = await page.evaluate('document.cookie');
        return typeof result === 'string' ? result : '';
    } catch {
        return '';
    }
}

/** Detect the "you are a guest" alert page that Discuz returns for protected actions. */
export function assertNotGuestAlert(html, domain = 'www.1point3acres.com') {
    if (/<title>提示信息 \| 一亩三分地<\/title>/.test(html) && /无法进行此操作/.test(html)) {
        throw new AuthRequiredError(domain, '需要登录一亩三分地后再使用该命令');
    }
}

const ENTITY_MAP = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

/** Decode HTML entities (numeric + common named). */
export function decodeEntities(s) {
    if (!s) return '';
    return s
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, m => ENTITY_MAP[m] || m);
}

/** Strip HTML tags and collapse whitespace, returning plain text. */
export function stripHtml(html) {
    if (!html) return '';
    return decodeEntities(
        String(html)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|div|li|tr)>/gi, '\n')
            .replace(/<[^>]+>/g, '')
    ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Truncate text to n characters with ellipsis. */
export function truncate(s, n = 300) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '…' : s;
}

/** Extract all <tbody id="normalthread_*"> blocks from a forum/guide page. */
export function parseThreadRows(html) {
    const rows = [];
    const re = /<tbody id="(normalthread|stickthread)_(\d+)"[^>]*>([\s\S]*?)<\/tbody>/g;
    let m;
    while ((m = re.exec(html))) {
        const [, kind, tid, inner] = m;
        rows.push({ kind, tid, inner });
    }
    return rows;
}

/** Parse a single Discuz thread row (inner HTML of the tbody). */
export function parseThreadRow({ kind, tid, inner }) {
    const titleMatches = [...inner.matchAll(/<a [^>]*class="[^"]*\bxst\b[^"]*"[^>]*>([^<]+)<\/a>/g)];
    const title = titleMatches.length
        ? decodeEntities(titleMatches[titleMatches.length - 1][1].trim())
        : '';

    const forumMatch = inner.match(/<a href="forum-(\d+)-1\.html"[^>]*target="_blank"[^>]*>([^<]+)<\/a>/);
    const fid = forumMatch ? forumMatch[1] : '';
    const forumName = forumMatch ? decodeEntities(forumMatch[2].trim()) : '';

    // <td class="by"> blocks; first with <cite> = author, last with <cite> = last reply
    const byBlocks = [...inner.matchAll(/<td class="by"[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    const readCite = (block) => {
        const m = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/);
        if (!m) return '';
        return decodeEntities(m[1].replace(/<[^>]+>/g, '').trim());
    };
    const readTime = (block) => {
        const titleM = block.match(/<span [^>]*title="([^"]+)"[^>]*>/);
        if (titleM) return titleM[1].trim();
        const plainA = block.match(/<em>[\s\S]*?<a [^>]*>\s*([^<]+?)\s*<\/a>/);
        if (plainA) return decodeEntities(plainA[1].trim());
        const plainSpan = block.match(/<em>[\s\S]*?<span[^>]*>\s*([^<]+?)\s*<\/span>/);
        if (plainSpan) return decodeEntities(plainSpan[1].trim());
        const bare = block.match(/<em>\s*([^<]+?)\s*<\/em>/);
        return bare ? decodeEntities(bare[1].trim()) : '';
    };
    let authorBlock = '';
    let lastBlock = '';
    for (const b of byBlocks) {
        if (/<cite/.test(b)) {
            if (!authorBlock) authorBlock = b;
            lastBlock = b;
        }
    }
    const author = authorBlock ? readCite(authorBlock) : '';
    const postTime = authorBlock ? readTime(authorBlock) : '';
    const lastReplyUser = lastBlock && lastBlock !== authorBlock ? readCite(lastBlock) : '';
    const lastReplyTime = lastBlock && lastBlock !== authorBlock ? readTime(lastBlock) : '';

    const numMatch = inner.match(/<td class="num"[^>]*>\s*<a[^>]*class="xi2"[^>]*>(\d+)<\/a>(?:\s*<em>(\d+)<\/em>)?/);
    const replies = numMatch ? Number(numMatch[1]) : 0;
    const views = numMatch && numMatch[2] ? Number(numMatch[2]) : 0;
    return {
        tid,
        kind,
        title,
        author,
        forum: forumName,
        fid,
        replies,
        views,
        postTime,
        lastReplyUser,
        lastReplyTime,
        url: `${BASE}/thread-${tid}-1-1.html`,
    };
}

/** Quick one-shot listing parser used by hot/latest/digest/forum. */
export function parseThreadList(html) {
    return parseThreadRows(html).map(parseThreadRow).filter(t => t.title);
}

/**
 * Parse Discuz search results page (different HTML shape than forum listings).
 * Each hit is <li class="pbw" id="TID"> containing h3 > a[href*="tid=TID"],
 * <p class="xg1">N 个回复 - M 次查看</p>, and a time/author/forum <p>.
 */
export function parseSearchList(html) {
    const items = [];
    const re = /<li class="pbw" id="(\d+)">([\s\S]*?)<\/li>/g;
    let m;
    while ((m = re.exec(html))) {
        const [, tid, inner] = m;
        const titleMatch = inner.match(/<h3[^>]*>\s*<a [^>]*>([\s\S]*?)<\/a>/);
        const titleRaw = titleMatch ? titleMatch[1] : '';
        const title = decodeEntities(titleRaw.replace(/<[^>]+>/g, '')).trim();
        if (!title) continue;

        const statsMatch = inner.match(/<p class="xg1">\s*([\d,]+)\s*个回复\s*-\s*([\d,]+)\s*次查看\s*<\/p>/);
        const replies = statsMatch ? Number(statsMatch[1].replace(/,/g, '')) : 0;
        const views = statsMatch ? Number(statsMatch[2].replace(/,/g, '')) : 0;

        const metaMatch = inner.match(/<p>\s*<span>([^<]+)<\/span>[\s\S]*?<a [^>]*space-uid-\d+[^>]*>([^<]+?)<\/a>[\s\S]*?<a [^>]*href="forum-(\d+)-[^"]*"[^>]*>([^<]+?)<\/a>/);
        const postTime = metaMatch ? decodeEntities(metaMatch[1].trim()) : '';
        const author = metaMatch ? decodeEntities(metaMatch[2].trim()) : '';
        const fid = metaMatch ? metaMatch[3] : '';
        const forumName = metaMatch ? decodeEntities(metaMatch[4].trim()) : '';

        items.push({
            tid, title, author, forum: forumName, fid,
            replies, views, postTime,
            // Search pages don't show lastReplyTime separately — surface postTime instead.
            lastReplyUser: '', lastReplyTime: postTime,
            url: `${BASE}/thread-${tid}-1-1.html`,
        });
    }
    return items;
}

export { UA };
