/**
 * Shared helpers for the 红果短剧 (Hongguo short drama) adapter.
 *
 * hongguoduanju.com is a ByteDance Modern.js app. Two data sources need no
 * login, cookie or signature:
 *
 * - SSR pages (`/rank/<slug>`, `/detail?series_id=`) embed the loader data as
 *   an inline `_ROUTER_DATA = {...};` script followed by more code, so the
 *   object is cut out with a string-aware brace scan, not a regex.
 * - JSON APIs under `/api/` (`/api/home/feed`, `/api/search/result`) answer
 *   plain fetches. The browser routes search through a bdms/captcha layer that
 *   can answer 403 `search_verification_required`; that case is surfaced as a
 *   typed error instead of an empty result.
 */

import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const HG_BASE = 'https://hongguoduanju.com';
export const HG_DOMAIN = 'hongguoduanju.com';
export const HG_AID = '8662';

const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export const FEED_COLUMNS = ['rank', 'series_id', 'title', 'episodes', 'tags', 'intro', 'url'];
export const RANK_COLUMNS = ['rank', 'series_id', 'title', 'metric', 'score', 'favorites', 'likes', 'episodes', 'tags', 'upcoming', 'url'];
export const SEARCH_COLUMNS = ['rank', 'series_id', 'title', 'episodes', 'heat', 'favorites', 'likes', 'tags', 'intro', 'url'];
export const DETAIL_COLUMNS = ['field', 'value'];
export const REVIEWS_COLUMNS = ['rank', 'scope', 'episode', 'user', 'rating', 'likes', 'time', 'content', 'scope_total'];

const MARKER = '_ROUTER_DATA = ';

/**
 * Cut the `_ROUTER_DATA` object literal out of an SSR page and parse it.
 * Returns null when the marker is missing, the braces never balance, or the
 * JSON is invalid.
 */
export function extractRouterData(html) {
    const text = String(html ?? '');
    const markerAt = text.indexOf(MARKER);
    if (markerAt < 0) return null;
    const start = text.indexOf('{', markerAt + MARKER.length);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(text.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

/** Fetch an SSR page and return `_ROUTER_DATA.loaderData`. 404 → EmptyResultError. */
export async function hgFetchLoaderData(path, label) {
    let resp;
    try {
        resp = await fetch(`${HG_BASE}${path}`, {
            headers: { 'User-Agent': UA, Referer: `${HG_BASE}/`, 'Accept-Language': 'zh-CN,zh;q=0.9' },
        });
    } catch (err) {
        throw new CommandExecutionError(`hongguo ${label} network error: ${err?.message || err}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(`hongguo ${label}`, 'Hongguo returned 404 — the id does not exist, or the series is not released yet (rank rows with upcoming=true have no detail page).');
    }
    if (!resp.ok) throw new CommandExecutionError(`hongguo ${label} HTTP ${resp.status}`);
    const data = extractRouterData(await resp.text());
    const loaderData = data?.loaderData;
    if (!loaderData || typeof loaderData !== 'object') {
        throw new CommandExecutionError(
            `hongguo ${label} page carried no _ROUTER_DATA`,
            'Hongguo likely changed its page structure, or the request hit an anti-bot page.',
        );
    }
    return loaderData;
}

/**
 * Call a Hongguo JSON API. Returns `{ body, cookies }` where cookies are the
 * `name=value` pairs from Set-Cookie (the feed keeps its session in `ttwid`).
 */
export async function hgFetchJson(path, { method = 'GET', params = {}, body, cookie, label }) {
    const url = new URL(`${HG_BASE}${path}`);
    url.searchParams.set('aid', HG_AID);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const headers = { 'User-Agent': UA, Origin: HG_BASE, Referer: `${HG_BASE}/`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    let resp;
    try {
        resp = await fetch(url.toString(), {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch (err) {
        throw new CommandExecutionError(`hongguo ${label} network error: ${err?.message || err}`);
    }
    let json = null;
    try {
        json = await resp.json();
    } catch {
        json = null;
    }
    if (resp.status === 403 && json?.code === 'search_verification_required') {
        throw new CommandExecutionError(
            `hongguo ${label} was challenged with a captcha (search_verification_required)`,
            'Hongguo wants a human verification for search; wait a while and retry, or search on hongguoduanju.com in a browser.',
        );
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`hongguo ${label} was rate limited (HTTP 429)`, 'Wait a few seconds and retry.');
    }
    if (!resp.ok) {
        const code = json?.error_code || json?.code;
        throw new CommandExecutionError(`hongguo ${label} HTTP ${resp.status}${code ? ` (${code})` : ''}`);
    }
    if (!json || typeof json !== 'object') {
        throw new CommandExecutionError(`hongguo ${label} returned a non-JSON body`);
    }
    const cookies = (typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : [])
        .map((c) => c.split(';')[0].trim())
        .filter(Boolean);
    return { body: json, cookies };
}

/** Accept a bare series id or a /detail?series_id= / /player/<id> URL. */
export function normalizeSeriesId(input) {
    const raw = String(input ?? '').trim();
    if (!raw) throw new ArgumentError('series_id must be a non-empty value');
    const m = raw.match(/[?&]series_id=(\d+)/) || raw.match(/\/player\/(\d+)/) || raw.match(/^(\d+)$/);
    if (!m) {
        throw new ArgumentError(
            `'${input}' does not look like a hongguo series id (digits, or a hongguoduanju.com/detail?series_id=<id> URL)`,
        );
    }
    return m[1];
}

/** Validate an integer limit in [1, max] without clamping. */
export function requireLimit(value, def, max) {
    const raw = value == null || value === '' ? def : value;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`limit must be an integer between 1 and ${max}`);
    }
    return n;
}

export function clean(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export function seriesUrl(seriesId) {
    return `${HG_BASE}/detail?series_id=${seriesId}`;
}

/** A series id is a long decimal string; anything else means the payload drifted. */
export function requireSeriesId(value, label) {
    const id = String(value ?? '').trim();
    if (!/^\d{6,}$/.test(id)) throw new CommandExecutionError(`${label} did not include a numeric series_id`);
    return id;
}

export function toInt(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/** Unix seconds → `YYYY-MM-DD` (or `YYYY-MM-DD HH:mm`) in China time, the site's calendar. */
export function formatChinaTime(seconds, { time = false } = {}) {
    const n = toInt(seconds);
    if (!n) return '';
    const text = new Date(n * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false });
    return time ? text.slice(0, 16) : text.slice(0, 10);
}

/** First loaderData entry matching `predicate` — loader keys are route-specific. */
export function findLoaderEntry(loaderData, predicate) {
    for (const value of Object.values(loaderData || {})) {
        if (value && typeof value === 'object' && predicate(value)) return value;
    }
    return null;
}

export function joinTags(list) {
    if (!Array.isArray(list)) return '';
    return list
        .map((t) => (typeof t === 'string' ? t : t?.name))
        .map(clean)
        .filter(Boolean)
        .join(', ');
}
