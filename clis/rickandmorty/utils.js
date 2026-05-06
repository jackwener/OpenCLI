// Rick and Morty API — character / episode listing.
//
// Public REST API at https://rickandmortyapi.com/api/. No auth, generous rate
// limits (~10000/day per IP, no per-second cap documented). Schema is stable
// — pagination is `?page=N` returning {info: {count, pages, next, prev}, results: [...]}.
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const RM_BASE = 'https://rickandmortyapi.com/api';
const UA = 'opencli-rickandmorty/1.0';
const PAGE_SIZE = 20; // server-fixed, can't override

export function requireBoundedInt(value, def, max, name = 'limit') {
    const n = value == null || value === '' ? def : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`--${name} must be an integer between 1 and ${max}`);
    }
    return n;
}

export async function rmFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        // RM API returns 404 with `{error: "There is nothing here"}` for no-match filters.
        throw new EmptyResultError(label, 'rickandmortyapi.com returned no matches.');
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

// Walk pages until we've collected at least `limit` rows or run out.
// Each page is server-fixed at 20. Caller slices to `limit`.
export async function paginate(firstUrl, limit, label) {
    const out = [];
    let url = firstUrl;
    while (url && out.length < limit) {
        const body = await rmFetch(url, label);
        const list = Array.isArray(body?.results) ? body.results : [];
        out.push(...list);
        url = body?.info?.next ?? null;
    }
    return out.slice(0, limit);
}

export { PAGE_SIZE };
