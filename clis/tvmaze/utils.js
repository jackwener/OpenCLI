// Shared helpers for the TVmaze adapters.
//
// TVmaze publishes a free, unauthenticated REST API at https://api.tvmaze.com.
// Docs: https://www.tvmaze.com/api
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const TVMAZE_BASE = 'https://api.tvmaze.com';
const UA = 'opencli-tvmaze-adapter (+https://github.com/jackwener/opencli)';

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`tvmaze ${label} cannot be empty`);
    return s;
}

export function requireShowId(value) {
    const raw = value;
    const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(
            'tvmaze show id is required and must be a positive integer',
            'TVmaze show ids appear in the URL: https://www.tvmaze.com/shows/<id>/<slug>.',
        );
    }
    return n;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`tvmaze ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`tvmaze ${label} must be <= ${maxValue}`);
    }
    return n;
}

export async function tvmazeFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api.tvmaze.com is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `TVmaze returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'TVmaze caps unauthenticated traffic at ~20 req/10s; wait a few seconds and retry.',
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

const HTML_ENTITY_MAP = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    hellip: '…',
    ndash: '–',
    mdash: '—',
};

// TVmaze ships HTML in `summary` ("<p><b>...</b> ...</p>"). Strip tags + decode
// named and numeric entities so output is plain text.
export function stripHtml(html) {
    if (html == null) return '';
    let s = String(html);
    s = s.replace(/<[^>]+>/g, '');
    s = s
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : '';
        })
        .replace(/&#(\d+);/g, (_, dec) => {
            const code = parseInt(dec, 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : '';
        })
        .replace(/&([a-zA-Z]+);/g, (match, name) => HTML_ENTITY_MAP[name] ?? match);
    return s.replace(/\s+/g, ' ').trim();
}

export function joinList(value) {
    return Array.isArray(value) ? value.filter(Boolean).join(', ') : '';
}
