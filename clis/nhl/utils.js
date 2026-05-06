// Shared helpers for the NHL (`api-web.nhle.com`) adapter.
//
// The NHL's modern web API at `api-web.nhle.com` is unauthenticated and
// JSON-only. Two endpoints we wrap:
//   GET /v1/standings/now            current league standings
//   GET /v1/standings/<YYYY-MM-DD>   standings as of date
//   GET /v1/schedule/now             current week schedule
//   GET /v1/schedule/<YYYY-MM-DD>    week starting <date>
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const NHL_BASE = 'https://api-web.nhle.com';
const UA = 'opencli-nhl-adapter (+https://github.com/jackwener/opencli)';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`nhl ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`nhl ${label} must be <= ${maxValue}`);
    }
    return n;
}

/** Validate `--date` if supplied; default behaviour is to use the `/now` endpoint. */
export function requireOptionalDate(value, label = 'date') {
    if (value == null || value === '') return null;
    const s = String(value).trim();
    if (!DATE_PATTERN.test(s)) {
        throw new ArgumentError(`nhl ${label} must be in YYYY-MM-DD format (e.g. "2026-01-15")`);
    }
    return s;
}

export async function nhlFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api-web.nhle.com is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `NHL API returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'NHL API throttles bursts; wait and retry.',
        );
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }
    let body;
    try {
        body = await resp.json();
    }
    catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
    return body;
}

/** NHL teams expose `name.default` (English) — surface the raw English string. */
export function pickEn(node) {
    if (!node) return '';
    if (typeof node === 'string') return node.trim();
    return String(node?.default ?? '').trim();
}

/** NHL game type id → label. 1=preseason, 2=regular, 3=playoffs, 4=allstar. */
export function gameTypeLabel(id) {
    switch (id) {
        case 1: return 'preseason';
        case 2: return 'regular';
        case 3: return 'playoff';
        case 4: return 'allstar';
        default: return id == null ? '' : String(id);
    }
}
