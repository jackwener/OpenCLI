// Shared helpers for the Open Library (`openlibrary.org`) adapter.
//
// Open Library is the Internet Archive's free book metadata index. The
// REST API is unauthenticated. Two endpoints we wrap:
//   GET /search.json?q=…             search across title/author/isbn
//   GET /works/<OLID>.json           single Work detail (or via ISBN)
//
// `OLID` is Open Library's id space: works are `OL\d+W`, editions
// `OL\d+M`, authors `OL\d+A`. We accept any of these in `work` plus
// raw ISBN-10/-13 (round-tripped through `/isbn/<isbn>.json`).
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const OL_BASE = 'https://openlibrary.org';
const UA = 'opencli-openlibrary-adapter (+https://github.com/jackwener/opencli)';

const OLID_PATTERN = /^OL\d+[WMA]$/;
const ISBN_PATTERN = /^(?:97[89]\d{10}|\d{9}[\dX])$/;

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

/** Classify an input as either an OLID or an ISBN (rejects everything else). */
export function classifyWorkRef(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ArgumentError('openlibrary work id is required (OLID like "OL45804W" or ISBN-10/-13)');
    }
    const upper = raw.toUpperCase();
    if (OLID_PATTERN.test(upper)) {
        return { kind: 'olid', value: upper };
    }
    const isbn = raw.replace(/[-\s]/g, '').toUpperCase();
    if (ISBN_PATTERN.test(isbn)) {
        return { kind: 'isbn', value: isbn };
    }
    throw new ArgumentError(`openlibrary work id "${value}" is not an OLID or ISBN`);
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
            'Open Library throttles bursts; wait and retry.',
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

/** Open Library exposes /isbn/<isbn>.json which 302-redirects to the edition; the edition links to the work. */
export async function resolveWorkOlidFromIsbn(isbn, label) {
    const editionUrl = `${OL_BASE}/isbn/${isbn}.json`;
    const edition = await olFetch(editionUrl, label);
    const works = Array.isArray(edition?.works) ? edition.works : [];
    const olKey = String(works[0]?.key ?? '').trim();
    const match = olKey.match(/(OL\d+W)$/);
    if (!match) {
        throw new EmptyResultError(label, `Open Library edition for ISBN ${isbn} has no linked work.`);
    }
    return match[1];
}

/** Open Library `description` is sometimes a string, sometimes `{value: '…'}`. Normalise. */
export function flattenDescription(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object' && typeof value.value === 'string') return value.value.trim();
    return '';
}

/** Strip `/authors/` prefix from a list of author keys + return their OLIDs. */
export function pickAuthorOlids(authors) {
    if (!Array.isArray(authors)) return [];
    return authors.map((a) => {
        const key = String(a?.author?.key ?? a?.key ?? '').trim();
        const m = key.match(/(OL\d+A)$/);
        return m ? m[1] : '';
    }).filter(Boolean);
}
