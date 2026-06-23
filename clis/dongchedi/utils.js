/**
 * Shared helpers for the 懂车帝 (Dongchedi) adapter.
 *
 * Dongchedi (a ByteDance car-info site) is a Next.js app that server-side
 * renders every functional page with a `<script id="__NEXT_DATA__">` blob
 * holding the full page data. A plain HTTP GET (no login, no signature, no
 * browser) returns that blob, so every command here is a PUBLIC `fetch()`
 * that pulls `props.pageProps` out of the SSR HTML and parses pure JSON —
 * no cookies, no anti-bot tokens, no DOM scraping.
 *
 * The koubei/config XHR JSON APIs (`/motor/...`) are ByteDance-signature
 * gated (a_bogus / X-Bogus) and 404 without a valid signature, so they are
 * deliberately NOT used — the SSR pages expose the same data unsigned.
 *
 * Scores are stored x100 ints (422 == 4.22 / 5) — `parseScore` rescales.
 */

import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

export const DCD_BASE = 'https://www.dongchedi.com';

const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const SEARCH_COLUMNS = ['rank', 'series_id', 'name', 'brand', 'official_price', 'dealer_price', 'pictures', 'url'];
export const SERIES_COLUMNS = ['field', 'value'];
export const MODELS_COLUMNS = ['car_id', 'name', 'year', 'official_price', 'dealer_price', 'owner_price'];
export const SPECS_COLUMNS = ['field', 'value'];
export const SCORE_COLUMNS = ['dimension', 'score', 'same_level_avg'];
export const KOUBEI_COLUMNS = ['rank', 'user', 'car', 'score', 'likes', 'comments', 'content', 'url'];

// pageProps keys present on Dongchedi's "city gateway / 404" fallback shell.
// A real page always carries more than just these housekeeping fields.
const FALLBACK_SHELL_KEYS = ['__hasUrlCity', 'is_gray', 'has_gray', 'clientIp', 'sensitiveSeriesIdList'];

/**
 * Extract `props.pageProps` from a Dongchedi SSR page's `__NEXT_DATA__`.
 *
 * Pure (string in, object|null out) so it runs identically against the
 * live `fetch()` body and the frozen JSDOM-free fixtures in the unit test.
 * Returns null when the blob is missing or unparseable.
 */
export function extractPageProps(html) {
    const m = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    try {
        const data = JSON.parse(m[1]);
        return (data && data.props && data.props.pageProps) || null;
    } catch {
        return null;
    }
}

/**
 * True when pageProps is Dongchedi's empty fallback shell (wrong URL form,
 * city gateway, or a soft 404) rather than a real data page.
 */
export function isFallbackShell(pp) {
    if (!pp || typeof pp !== 'object') return true;
    const real = Object.keys(pp).filter((k) => !FALLBACK_SHELL_KEYS.includes(k));
    return real.length === 0;
}

/**
 * Fetch a Dongchedi page and return its parsed `pageProps`.
 * Throws typed errors so callers can let them propagate.
 */
export async function dcdFetchPageProps(path, contextHint) {
    let resp;
    try {
        resp = await fetch(`${DCD_BASE}${path}`, {
            headers: {
                'User-Agent': UA,
                Referer: `${DCD_BASE}/`,
                'Accept-Language': 'zh-CN,zh;q=0.9',
            },
        });
    } catch (err) {
        throw new CommandExecutionError(
            `dongchedi ${contextHint} network error: ${err?.message || err}`,
        );
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`dongchedi ${contextHint} HTTP ${resp.status}`);
    }
    const html = await resp.text();
    const pp = extractPageProps(html);
    if (!pp) {
        throw new CommandExecutionError(
            `dongchedi ${contextHint} returned no __NEXT_DATA__`,
            'Dongchedi likely changed its page structure, or the request hit an anti-bot page.',
        );
    }
    if (isFallbackShell(pp)) {
        throw new CommandExecutionError(
            `dongchedi ${contextHint}`,
            'Dongchedi served its empty fallback shell — the id may not exist or the URL form changed.',
        );
    }
    return pp;
}

export function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommandExecutionError(`${label} returned an unexpected payload shape; expected an object.`);
    }
    return value;
}

export function requireArray(value, label) {
    if (!Array.isArray(value)) {
        throw new CommandExecutionError(`${label} returned an unexpected payload shape; expected an array.`);
    }
    return value;
}

export function requireStableId(value, label) {
    const id = String(value ?? '').trim();
    if (!/^\d+$/.test(id) || id === '0') {
        throw new CommandExecutionError(`${label} did not include a stable numeric id.`);
    }
    return id;
}

export function requireText(value, label) {
    const text = clean(value);
    if (!text) {
        throw new CommandExecutionError(`${label} did not include a stable text value.`);
    }
    return text;
}

/** Rescale a Dongchedi x100 score int (422) to a /5 float (4.22). */
export function parseScore(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Number((n / 100).toFixed(2));
}

/**
 * Normalize a series id argument: a bare number, or a
 * `https://www.dongchedi.com/auto/series/<id>` URL.
 */
export function normalizeSeriesId(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) throw new ArgumentError('series_id must be a non-empty value');
    const m = raw.match(/series\/(\d+)/) || raw.match(/^(\d+)$/);
    if (!m) {
        throw new ArgumentError(
            `'${rawInput}' does not look like a dongchedi series id (a number, or a /auto/series/<id> URL)`,
        );
    }
    return m[1];
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

/** Collapse whitespace and trim; returns '' for nullish. */
export function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/** Truncate long review text for table display, keeping it on one line. */
export function snippet(s, max = 180) {
    const t = clean(s);
    return t.length > max ? `${t.slice(0, max)}…` : t;
}
