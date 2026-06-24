/**
 * Shared helpers for the 太平洋电脑网 (PConline) product-库 adapter.
 *
 * PConline (product.pconline.com.cn, "Pacific Computer Network") is one of
 * China's oldest digital-product catalogues — phones, laptops, cameras, CPUs,
 * GPUs, tablets, watches, etc., each with a full 参数 (spec) sheet. Every
 * 产品库 page is plain server-rendered HTML, **GBK-encoded** and **gzip'd**;
 * Node's `fetch` transparently inflates the gzip, after which the bytes are
 * decoded with `TextDecoder('gbk')` (same GBK family as ZOL / autohome).
 *
 * So every command here is a PUBLIC `fetch()` (no login, no cookies, no
 * signature). A product is addressed by a `<category>/<brand>/<id>` triple,
 * surfaced by `list` and embedded in every detail URL:
 *
 *   product.pconline.com.cn/<cat>/<brand>/<id>.html          → overview  (info)
 *   product.pconline.com.cn/<cat>/<brand>/<id>_detail.html   → 参数        (param)
 *
 * The bare numeric id is NOT enough — the `pdlib/<id>_…` id-only form 404s, so
 * detail commands need the full triple (or the URL `list` prints).
 *
 * Keyword search (ks.pconline.com.cn 快搜) and the legacy 报价/点评 XHR APIs
 * (`ppc…/shop_list_new2015.jsp`, `pdcmt…/mtp-list.jsp`) are deliberately NOT
 * used: the search path is behind a JS/anti-bot challenge (HTTP 503 to a plain
 * fetch — not a login gate, so credentials wouldn't help), the price API is
 * retired (404), and the comment API returns empty shells. `list` is the
 * reliable discovery entry instead.
 */

import {
    ArgumentError,
    CommandExecutionError,
} from '@jackwener/opencli/errors';

export const PC_PRODUCT = 'https://product.pconline.com.cn';
export const PC_PPC = 'https://ppc.pconline.com.cn';

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const LIST_COLUMNS = ['rank', 'product_id', 'name', 'category', 'brand', 'price', 'url'];
export const INFO_COLUMNS = ['field', 'value'];
export const PARAM_COLUMNS = ['field', 'value'];
export const PRICE_COLUMNS = ['mall', 'price', 'date'];

/** Known 产品库 category slugs → 中文 name (for `list` help + nicer errors). */
export const CATEGORIES = {
    mobile: '手机', notebook: '笔记本', tabletpc: '平板电脑', dc: '数码相机',
    cpu: '处理器', vga: '显卡', smartwatch: '智能手表', mainboard: '主板',
    monitor: '显示器', tv: '电视', router: '路由器', printer: '打印机',
    earphone: '耳机', keyboard: '键盘', mouse: '鼠标', ssd: '固态硬盘',
    camera: '摄像机', projector: '投影机', tablet: '平板电脑',
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
        String(html).replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, ' '),
    ).replace(/\s+/g, ' ').trim();
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
 * Normalize a product reference into its `<category>/<brand>/<id>` parts.
 *
 * Accepts a full PConline detail URL (`product.pconline.com.cn/mobile/apple/
 * 2718819.html`, with or without scheme / a `_detail`/`_price` suffix) or the
 * bare `mobile/apple/2718819` triple. A lone numeric id is rejected — PConline
 * detail pages can't be resolved from the id alone, so the caller must pass the
 * URL printed by `list`.
 */
export function normalizeProduct(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) throw new ArgumentError('product must be a non-empty value');
    const m = raw.match(/([a-z]+)\/([a-z0-9]+)\/(\d+)(?:[._/]|\.html|$)/i);
    if (!m) {
        if (/^\d+$/.test(raw)) {
            throw new ArgumentError(
                `'${rawInput}' is a bare id — PConline needs the full product URL `
                + '(e.g. product.pconline.com.cn/mobile/apple/2718819.html). Use `list` to get one.',
            );
        }
        throw new ArgumentError(
            `'${rawInput}' does not look like a PConline product URL `
            + '(expected product.pconline.com.cn/<category>/<brand>/<id>.html)',
        );
    }
    return { category: m[1].toLowerCase(), brand: m[2].toLowerCase(), id: m[3] };
}

/** Build the canonical detail base `product.pconline.com.cn/<cat>/<brand>/<id>`. */
export function productBase({ category, brand, id }) {
    return `${PC_PRODUCT}/${category}/${brand}/${id}`;
}

/**
 * Extract just the numeric product id from a URL/triple or a bare id. The
 * price JSON API is keyed by id alone, so (unlike `info`/`param`) a bare id is
 * accepted here.
 */
export function normalizeProductId(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) throw new ArgumentError('product must be a non-empty value');
    if (/^\d+$/.test(raw)) return raw;
    const m = raw.match(/\/(?:[a-z]+\/[a-z0-9]+\/)?(\d+)(?:[._/]|\.html|$)/i);
    if (!m) {
        throw new ArgumentError(
            `'${rawInput}' does not look like a PConline product id or URL`,
        );
    }
    return m[1];
}

/** Format an epoch-ms timestamp as YYYY-MM-DD (null for falsy/invalid). */
export function fmtDate(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n).toISOString().slice(0, 10);
}

/**
 * Fetch a PConline JSON API (UTF-8) and return the parsed object. Used for the
 * price endpoint on `ppc.pconline.com.cn`, which is a plain public JSON service
 * (no login, no signature) on a host separate from the rate-limited 产品库.
 */
export async function pcFetchJson(url, contextHint) {
    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                'User-Agent': UA,
                Referer: `${PC_PRODUCT}/`,
                'Accept-Language': 'zh-CN,zh;q=0.9',
            },
        });
    } catch (err) {
        throw new CommandExecutionError(`pconline ${contextHint} network error: ${err?.message || err}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`pconline ${contextHint} HTTP ${resp.status}`);
    }
    try {
        return await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`pconline ${contextHint} bad JSON: ${err?.message || err}`);
    }
}

/**
 * Fetch a PConline page and return GBK-decoded UTF-8 HTML.
 *
 * Pure transport (no parsing) so command-level parsers stay testable against
 * frozen fixtures. Sends a desktop UA + referer; `fetch` inflates the gzip
 * body, then the GBK bytes are decoded natively.
 */
export async function pcFetch(url, contextHint) {
    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                'User-Agent': UA,
                Referer: `${PC_PRODUCT}/`,
                'Accept-Language': 'zh-CN,zh;q=0.9',
            },
        });
    } catch (err) {
        throw new CommandExecutionError(`pconline ${contextHint} network error: ${err?.message || err}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`pconline ${contextHint} HTTP ${resp.status}`);
    }
    const buf = await resp.arrayBuffer();
    return new TextDecoder('gbk').decode(buf);
}
