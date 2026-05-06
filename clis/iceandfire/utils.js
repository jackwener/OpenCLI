// An API of Ice and Fire — Game of Thrones / ASOIAF books, characters, houses.
//
// Public API at https://anapioficeandfire.com/api. No auth, no API key.
// Pagination via `?page=N&pageSize=M` (server caps pageSize at 50). Pagination
// links surfaced via `Link` header (RFC 5988); we walk pages until limit hit.
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const IAF_BASE = 'https://anapioficeandfire.com/api';
const UA = 'opencli-iceandfire/1.0';
const PAGE_SIZE = 50; // server cap

export function requireBoundedInt(value, def, max, name = 'limit') {
    const n = value == null || value === '' ? def : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`--${name} must be an integer between 1 and ${max}`);
    }
    return n;
}

export async function iafFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, 'anapioficeandfire.com returned no matches.');
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} rate-limited (HTTP 429); back off and retry.`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}.`);
    }
    let body;
    try {
        body = await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned non-JSON body: ${err.message}`);
    }
    return body;
}

// Walk pages of `?page=N&pageSize=PAGE_SIZE` until we have at least `limit`
// rows or the server returns fewer than PAGE_SIZE (last page).
export async function paginate(baseUrl, limit, extraParams, label) {
    const out = [];
    let page = 1;
    while (out.length < limit) {
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        for (const [k, v] of Object.entries(extraParams || {})) {
            if (v != null && v !== '') params.set(k, String(v));
        }
        const url = `${baseUrl}?${params.toString()}`;
        const body = await iafFetch(url, label);
        if (!Array.isArray(body) || body.length === 0) break;
        out.push(...body);
        if (body.length < PAGE_SIZE) break;
        page += 1;
    }
    return out.slice(0, limit);
}

// Extract the trailing path segment as a stable id (e.g. /api/books/1 → "1").
export function urlToId(url) {
    if (typeof url !== 'string' || !url) return null;
    const m = url.match(/\/(\d+)\/?$/);
    return m ? m[1] : null;
}
