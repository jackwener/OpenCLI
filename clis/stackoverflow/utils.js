// Shared helpers for stackoverflow adapters using the Stack Exchange API.
//
// Public endpoint (api.stackexchange.com 2.3) accepts unauthenticated traffic
// up to 300 requests/day per IP for read endpoints, plenty for ad-hoc CLI use.
// We always set `site=stackoverflow` and decode the gzipped/HTML body via the
// returned JSON envelope.
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

export const SE_API = 'https://api.stackexchange.com/2.3';
export const SE_SITE = 'stackoverflow';

const UA = 'opencli-stackoverflow (+https://github.com/jackwener/opencli)';

/** Validate `limit` per typed-fail-fast convention (no silent clamp). */
export function normalizeLimit(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    if (limit > maxValue) {
        throw new ArgumentError(`${label} must be <= ${maxValue}`);
    }
    return limit;
}

export function requireString(value, label) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ArgumentError(`${label} cannot be empty`);
    }
    return raw;
}

/** Fetch a Stack Exchange API endpoint and return parsed JSON envelope. */
export async function seFetch(path, { searchParams } = {}) {
    const url = new URL(path.startsWith('http') ? path : `${SE_API}${path.startsWith('/') ? '' : '/'}${path}`);
    if (searchParams) {
        for (const [k, v] of Object.entries(searchParams)) {
            if (v == null || v === '') continue;
            url.searchParams.set(k, String(v));
        }
    }
    if (!url.searchParams.has('site')) url.searchParams.set('site', SE_SITE);

    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'User-Agent': UA,
            },
        });
    } catch (error) {
        throw new CommandExecutionError(`stack exchange request failed: ${error?.message || error}`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError('stack exchange returned HTTP 429 (rate limited)', 'Wait a few seconds and retry, or lower --limit.');
    }
    if (!resp.ok) {
        let body = '';
        try { body = (await resp.json())?.error_message || ''; } catch { /* ignore */ }
        throw new CommandExecutionError(`stack exchange HTTP ${resp.status}: ${body || resp.statusText}`);
    }
    let data;
    try {
        data = await resp.json();
    } catch (error) {
        throw new CommandExecutionError(`stack exchange returned malformed JSON: ${error?.message || error}`);
    }
    if (data?.error_id) {
        throw new CommandExecutionError(
            `stack exchange API error: ${data.error_message || data.error_name}`,
            'Inspect the URL in a browser for the canonical error context.',
        );
    }
    return data;
}

/** Convert SE epoch seconds to YYYY-MM-DD. */
export function epochToDate(value) {
    if (value == null || value === '') return '';
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return new Date(n * 1000).toISOString().slice(0, 10);
}

/** Throw EmptyResultError when an /items array is empty. */
export function ensureItems(data, label) {
    const items = Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) {
        throw new EmptyResultError(label, `${label} returned no items.`);
    }
    return items;
}

const HTML_ENTITY_MAP = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/**
 * Decode the small set of HTML entities Stack Exchange emits in display
 * names and titles (e.g. "Jon Skeet&#39;s mentor"). Decimal/hex numeric
 * refs are also handled.
 */
export function decodeHtmlEntities(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITY_MAP[m] || m);
}
