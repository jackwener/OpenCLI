// Shared helpers for the Open Library adapters.
//
// Hits the public, unauthenticated `openlibrary.org` REST endpoints. Open Library
// is the Internet Archive's open book metadata service; everything is JSON, no
// API key. Work / edition / author keys look like `OL45804W` (W=work, M=edition,
// A=author). Search is `https://openlibrary.org/search.json`.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const OL_BASE = 'https://openlibrary.org';
const UA = 'opencli-openlibrary-adapter/1.0 (+https://github.com/jackwener/opencli)';

const WORK_KEY = /^OL\d+W$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`openlibrary ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`openlibrary ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`openlibrary ${label} must be <= ${maxValue}`);
    }
    return n;
}

/**
 * Normalise a work key to the canonical `OL<digits>W` form. Accepts a bare key
 * (`OL45804W`), an `/works/OL45804W` path, or an `https://openlibrary.org/...`
 * URL. Editions (`OL...M`) and authors (`OL...A`) are rejected — `work` only
 * supports works.
 */
export function requireWorkKey(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ArgumentError('openlibrary work key is required (e.g. "OL45804W")');
    }
    const stripped = raw
        .replace(/^https?:\/\/openlibrary\.org/i, '')
        .replace(/^\/works\//i, '')
        .replace(/\.json$/i, '');
    if (!WORK_KEY.test(stripped)) {
        throw new ArgumentError(
            `openlibrary work key "${value}" is not a valid work id`,
            'Expected format: "OL<digits>W" (e.g. "OL45804W"). Editions (OL...M) are not supported.',
        );
    }
    return stripped;
}

/**
 * Open Library descriptions can be either a plain string or an object
 * `{type: '/type/text', value: '...'}`. Normalise to a plain trimmed string.
 */
export function flattenDescription(field) {
    if (typeof field === 'string') return field.trim();
    if (field && typeof field === 'object' && typeof field.value === 'string') {
        return field.value.trim();
    }
    return '';
}

export async function olFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that openlibrary.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Open Library returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Open Library throttles unauthenticated traffic; wait a few seconds and retry.',
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
