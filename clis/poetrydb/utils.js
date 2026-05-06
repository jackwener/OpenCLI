// Shared helpers for the PoetryDB (`poetrydb.org`) adapter.
//
// PoetryDB is a free, open API of public-domain English poetry.
// Endpoints we wrap:
//   GET /author/<name>           poems by author (also: /title/<text>)
//   GET /random/<count>          random poem(s)
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const POETRYDB_BASE = 'https://poetrydb.org';
const UA = 'opencli-poetrydb-adapter (+https://github.com/jackwener/opencli)';

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`poetrydb ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`poetrydb ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`poetrydb ${label} must be <= ${maxValue}`);
    }
    return n;
}

export async function poetrydbFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that poetrydb.org is reachable from this network.',
        );
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'PoetryDB throttles bursts; wait and retry.',
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

/**
 * PoetryDB returns `{status: 404, reason: 'Not found'}` (HTTP 200 wrapping) when
 * a search has no matches. Promote that to EmptyResultError.
 */
export function isPoetryDbNotFound(body) {
    if (!body || typeof body !== 'object') return false;
    if (Array.isArray(body)) return false;
    return body.status === 404 || /not found/i.test(String(body.reason ?? ''));
}

/** Project a PoetryDB poem object onto our standard row. */
export function projectPoem(p) {
    const lines = Array.isArray(p?.lines) ? p.lines : [];
    return {
        title: String(p?.title ?? '').trim(),
        author: String(p?.author ?? '').trim(),
        lineCount: Number(p?.linecount ?? lines.length) || lines.length,
        firstLine: lines[0] ? String(lines[0]).trim() : '',
        lastLine: lines.length ? String(lines[lines.length - 1]).trim() : '',
        text: lines.join('\n'),
        url: `https://poetrydb.org/title/${encodeURIComponent(String(p?.title ?? '').trim())}/lines.json`,
    };
}
