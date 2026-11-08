// tencent-map shared helpers — Tencent Maps (腾讯位置服务) public WebService.
//
// Source of the contract: the coordinate picker at https://lbs.qq.com/getPoint/
// is a thin front-end over this gateway. Recon (2026-09) showed the page itself
// calls `https://h5gw.map.qq.com/ws/...` with a literal `key=[你的key]`
// placeholder that the gateway substitutes for the site's own credential.
// Replaying those requests from Node returns real data with no cookie, no
// login and no browser — hence Strategy.PUBLIC.
//
// Two details that are easy to get wrong and were both verified by hand:
//   1. every request MUST carry `apptag`; without it the gateway answers
//      `700 参数错误` even when the rest of the query is well-formed;
//   2. `place/v1/search` additionally REQUIRES `boundary`, and `region(全国,0)`
//      is accepted syntactically but always yields 0 results — so a nationwide
//      keyword lookup must go through `place/v1/suggestion` instead.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const TMAP_HOST = 'h5gw.map.qq.com';
export const TMAP_BASE = `https://${TMAP_HOST}/ws`;
export const TMAP_KEY = '[你的key]';
export const TMAP_REFERER = 'https://lbs.qq.com/';

const UA = 'Mozilla/5.0 (compatible; opencli-tencent-map/1.0)';

/** `apptag` values the getPoint page uses, one per WebService. */
export const APPTAG = {
    search: 'lbsplace_search',
    suggestion: 'lbsplace_sug',
    geocoder: 'lbs_geocoder',
};

/** Tencent answers `0` for success and a small integer otherwise. */
export const STATUS_OK = 0;
/** `348 参数错误` — the request was well-formed but the input cannot be resolved. */
export const STATUS_BAD_ARGUMENT = 348;

export function requireString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ArgumentError(`--${name} is required`);
    }
    return value.trim();
}

/** Validate a positive integer without silently flooring or clamping it. */
export function normalizePositiveInteger(value, defaultValue, label = 'value', { min = 1 } = {}) {
    const raw = value ?? defaultValue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new ArgumentError(`${label} must be a positive integer`);
    if (n < min) throw new ArgumentError(`${label} must be >= ${min}`);
    return n;
}

/** Positive integer with an explicit ceiling (no clamp — out of range throws). */
export function normalizeLimit(value, defaultValue, maxValue, label = 'limit') {
    const n = normalizePositiveInteger(value, defaultValue, label);
    if (n > maxValue) throw new ArgumentError(`${label} must be <= ${maxValue}`);
    return n;
}

/**
 * Call one WebService and unwrap the `{status, message, ...}` envelope.
 *
 * `treatStatusAsArgument` lists statuses that mean "this input is unusable for
 * this endpoint" rather than an infrastructure failure — currently `348` for
 * the geocoder, which refuses addresses that carry no city component.
 */
export async function tmapRequest(path, params, label, {
    apptag,
    treatStatusAsArgument = [],
    argumentHint,
} = {}) {
    const url = new URL(`${TMAP_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
    }
    url.searchParams.set('key', TMAP_KEY);
    url.searchParams.set('output', 'json');
    if (apptag) url.searchParams.set('apptag', apptag);

    let resp;
    try {
        resp = await fetch(url, {
            headers: { 'User-Agent': UA, Referer: TMAP_REFERER, accept: 'application/json' },
        });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err?.message || err}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }

    let body;
    try {
        body = await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned a non-JSON body (${err?.message || err})`);
    }
    if (!body || typeof body !== 'object') {
        throw new CommandExecutionError(`${label} returned an unexpected body`);
    }

    const status = Number(body.status);
    if (status === STATUS_OK) return body;

    const message = typeof body.message === 'string' ? body.message : 'unknown error';
    if (treatStatusAsArgument.includes(status)) {
        throw new ArgumentError(`${label} could not resolve the input: ${message} (status ${status})`, argumentHint);
    }
    throw new CommandExecutionError(`${label} failed: ${message} (status ${status})`);
}

/** Throw the canonical "no rows" error for a site command. */
export function emptyResult(command, hint) {
    return new EmptyResultError(command, hint);
}

/**
 * Fold `--region` into the address text.
 *
 * Tencent's geocoder rejects an address with no city component outright
 * (`天安门` → 348, while `北京市天安门` resolves), and it has no separate region
 * parameter. So `--region` is applied by prefixing the text — and only when the
 * text does not already mention the region, so a full address is never
 * duplicated. The final string is echoed back in the `query` column.
 */
export function assembleAddress(region, address) {
    const city = typeof region === 'string' ? region.trim() : '';
    const text = address.trim();
    if (!city || text.includes(city)) return text;
    return `${city}${text}`;
}

// `place/v1/search` caps page_size at 20; suggestion uses the same cap.
export const TMAP_PAGE_SIZE = 20;
// Hard stop so a large --limit cannot turn into an unbounded request loop.
export const TMAP_MAX_PAGES = 5;
