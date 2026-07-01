/**
 * Shared helpers for the 中关村在线 (ZOL) adapter.
 *
 * ZOL (zol.com.cn, "ZhongGuanCun Online") is China's largest digital-product
 * catalogue — phones, laptops, cameras, etc., each with full specs, an
 * e-commerce 报价 (price) panel and reviews. Every functional page is plain
 * server-rendered HTML, **GBK-encoded**, served only when the request carries
 * a desktop User-Agent + a zol referer (a mobile UA gets a 153-byte stub).
 *
 * So every command here is a PUBLIC `fetch()` (no login, no cookies, no
 * signature) that:
 *   1. GETs the page with a desktop UA + referer,
 *   2. decodes the GBK bytes to UTF-8 via `TextDecoder('gbk')`,
 *   3. parses the HTML with regex — there is no JSON blob to read.
 *
 * Product detail sub-pages resolve by **productId alone**: the subcategory
 * segment in `detail.zol.com.cn/<subcat>/<productId>/param.shtml` is cosmetic
 * (1428, 1, 99999 all return the same product), so `param`/`price` only need
 * the productId surfaced by `search`.
 */

import {
    ArgumentError,
    CommandExecutionError,
} from '@jackwener/opencli/errors';

export const ZOL_DETAIL = 'https://detail.zol.com.cn';
export const ZOL_SEARCH = 'https://search.zol.com.cn';
export const ZOL_TOP = 'https://top.zol.com.cn';

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const SEARCH_COLUMNS = ['rank', 'product_id', 'name', 'price', 'url'];
export const PARAM_COLUMNS = ['field', 'value'];
export const PRICE_COLUMNS = ['platform', 'seller', 'price', 'url'];
export const KOUBEI_COLUMNS = ['rank', 'user', 'score', 'subscores', 'content', 'date', 'url'];
export const PIC_COLUMNS = ['rank', 'type', 'url'];
export const RANK_COLUMNS = ['category', 'rank', 'product_id', 'name', 'price', 'url'];

const ENTITY_MAP = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

/** Decode HTML entities (numeric + the common named ones). */
export function decodeEntities(s) {
    if (!s) return '';
    return s
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (m) => ENTITY_MAP[m] || m);
}

/** Strip HTML tags, decode entities, collapse whitespace. */
export function stripHtml(html) {
    if (!html) return '';
    return decodeEntities(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Collapse whitespace and trim; returns '' for nullish. */
export function clean(s) {
    return decodeEntities(String(s == null ? '' : s)).replace(/\s+/g, ' ').trim();
}

/** Strip HTML to text, then truncate to `max` chars with an ellipsis. */
export function snippet(html, max = 160) {
    const t = stripHtml(html);
    return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Convert a ZOL star bar (`<em style="width:96%">`) to a 0–5 score.
 * The bar width is a percentage of five full stars, so 96% → 4.8.
 * Returns null when no width is present.
 */
export function starScore(widthPercent) {
    if (widthPercent == null || widthPercent === '') return null;
    const n = Number(widthPercent);
    if (!Number.isFinite(n)) return null;
    return Math.round((n / 20) * 10) / 10;
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

/**
 * Normalize a product id argument: a bare number, a ZOL detail URL
 * (`.../index<id>.shtml` or `.../<subcat>/<id>/param.shtml`), or the
 * `product_id` printed by `search`.
 */
export function normalizeProductId(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) throw new ArgumentError('product_id must be a non-empty value');
    const m =
        raw.match(/index(\d+)\.shtml/)
        || raw.match(/\/(\d+)\/(?:param|price|review|pic)\.shtml/)
        || raw.match(/^(\d+)$/);
    if (!m) {
        throw new ArgumentError(
            `'${rawInput}' does not look like a ZOL product id (a number, or a detail.zol.com.cn URL)`,
        );
    }
    return m[1];
}

/**
 * Fetch a ZOL page and return GBK-decoded UTF-8 HTML.
 *
 * Pure transport (no parsing) so the command-level parsers stay testable
 * against frozen fixtures. Sends a desktop UA + referer (mobile UA gets a
 * stub) and decodes the GBK body natively.
 */
export async function zolFetch(url, contextHint) {
    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                'User-Agent': UA,
                Referer: `${ZOL_DETAIL}/`,
                'Accept-Language': 'zh-CN,zh;q=0.9',
            },
        });
    } catch (err) {
        throw new CommandExecutionError(`zol ${contextHint} network error: ${err?.message || err}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`zol ${contextHint} HTTP ${resp.status}`);
    }
    const buf = await resp.arrayBuffer();
    return new TextDecoder('gbk').decode(buf);
}
