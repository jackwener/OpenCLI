// Shared helpers for the IETF RFC adapter.
//
// datatracker.ietf.org publishes a free, unauthenticated REST API. The
// `/doc/<name>/doc.json` endpoint returns rich metadata for any IETF document
// (RFCs, internet drafts, etc.). Docs: https://datatracker.ietf.org/api/
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const RFC_BASE = 'https://datatracker.ietf.org';
const UA = 'opencli-rfc-adapter (+https://github.com/jackwener/opencli)';

export function requireRfcNumber(value) {
    const raw = value;
    if (raw == null || String(raw).trim() === '') {
        throw new ArgumentError(
            'rfc number is required (e.g. 9000, 791, 2616)',
            'Pass the integer RFC number; do not include the "rfc" prefix.',
        );
    }
    // Accept "9000" or 9000 or "rfc9000" as a courtesy.
    const s = String(raw).trim().toLowerCase().replace(/^rfc/, '');
    const n = Number.parseInt(s, 10);
    if (!Number.isInteger(n) || n <= 0 || String(n) !== s) {
        throw new ArgumentError(
            `rfc number "${value}" is not a valid RFC number`,
            'Pass a positive integer (e.g. 9000, 791, 2616).',
        );
    }
    if (n > 999999) {
        throw new ArgumentError('rfc number must be <= 999999');
    }
    return n;
}

export async function rfcFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that datatracker.ietf.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `IETF datatracker returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} returned HTTP 429 (rate limited)`);
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

// IETF datatracker timestamps are like "2022-02-19 08:46:51" (no T, no Z)
// or ISO with offset like "2016-07-08T21:03:52+00:00". Normalise to YYYY-MM-DD.
export function trimDate(value) {
    const s = String(value ?? '').trim();
    if (!s) return null;
    // Take the first 10 chars only if they form a YYYY-MM-DD prefix.
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
}
