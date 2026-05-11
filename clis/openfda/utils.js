// openFDA shared helpers — FDA drug labels + food recall enforcement (no auth, public).
//
// Free public tier with anonymous rate limit (~240 req/min, 1000 req/day per IP).
// API key bumps that to 240 req/min × ~120000 req/day, but is not required for
// modest read traffic.
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const OPENFDA_BASE = 'https://api.fda.gov';
const UA = 'opencli-openfda/1.0';

export function requireString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ArgumentError(`--${name} is required`);
    }
    return value.trim();
}

export function requireBoundedInt(value, def, max, name = 'limit') {
    const n = value == null || value === '' ? def : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`--${name} must be an integer between 1 and ${max}`);
    }
    return n;
}

export async function openfdaFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        // openFDA returns 404 for "no matches" instead of an empty results array.
        throw new EmptyResultError(label, `${label} returned 404 (no matches).`);
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

// openFDA returns most string fields as `[string]` arrays — collapse to first
// element. Preserves `null` (not coerced to empty string) when the slot is
// missing entirely.
export function firstOrNull(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    const v = arr[0];
    if (typeof v !== 'string') return v ?? null;
    const trimmed = v.trim();
    return trimmed.length ? trimmed : null;
}

// Comma-join an array of strings, preserving null when empty.
export function joinOrNull(arr, max = 5) {
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.slice(0, max).map(String).join(', ');
}
