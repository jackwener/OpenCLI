// Shared helpers for the OpenAlex (`api.openalex.org`) adapter.
//
// OpenAlex is a free, open scholarly works database. The REST API is
// unauthenticated; passing an email via `mailto=` opts into the polite pool
// (faster). Work IDs are `W` followed by digits (`W2741809807`) and
// round-trip via `https://api.openalex.org/works/<id>` or
// `https://openalex.org/W…`.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const OPENALEX_BASE = 'https://api.openalex.org';
const UA = 'opencli-openalex-adapter (+https://github.com/jackwener/opencli)';

// OpenAlex stable IDs: a single-letter prefix (`W` works, `A` authors, `S`
// sources, `I` institutions…) + at least 4 digits. We accept just `W` here.
const WORK_ID = /^W\d{4,}$/;
// DOIs are loose — accept anything starting with "10." after the optional
// `doi.org/` prefix; OpenAlex itself does the normalization.
const DOI_BARE = /^10\.\S+$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`openalex ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`openalex ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`openalex ${label} must be <= ${maxValue}`);
    }
    return n;
}

/**
 * Resolve a user-supplied work identifier to OpenAlex's canonical path
 * segment. Accepts `W…` IDs, `doi:10.…`, raw DOIs, or full
 * `https://doi.org/…` / `https://openalex.org/W…` URLs.
 */
export function requireWorkRef(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ArgumentError('openalex work id is required (e.g. "W2741809807", "10.7717/peerj.4375")');
    }
    // 1) full openalex URL
    const oaUrl = raw.match(/^https?:\/\/(?:api\.)?openalex\.org\/(?:works\/)?([WAaSCFwIPwT]\d+)/i);
    if (oaUrl) {
        const id = oaUrl[1].toUpperCase();
        if (id[0] !== 'W') {
            throw new ArgumentError(`openalex work id "${value}" must be a Work (W…) ID, got "${id[0]}…"`);
        }
        return id;
    }
    // 2) bare W… id
    if (WORK_ID.test(raw.toUpperCase())) {
        return raw.toUpperCase();
    }
    // 3) doi:… prefix
    if (/^doi:/i.test(raw)) {
        const doi = raw.replace(/^doi:/i, '').trim();
        if (DOI_BARE.test(doi)) return `doi:${doi}`;
    }
    // 4) full doi URL
    const doiUrl = raw.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
    if (doiUrl && DOI_BARE.test(doiUrl[1])) {
        return `doi:${doiUrl[1]}`;
    }
    // 5) bare 10.xxxx/yyy DOI
    if (DOI_BARE.test(raw)) {
        return `doi:${raw}`;
    }
    throw new ArgumentError(
        `openalex work id "${value}" is not recognised`,
        'Use a Work id ("W2741809807"), a DOI ("10.7717/peerj.4375"), or a full openalex.org / doi.org URL.',
    );
}

export async function openalexFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api.openalex.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `OpenAlex returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'OpenAlex throttles unauthenticated traffic; wait a few seconds and retry, or set OPENALEX_MAILTO.',
        );
    }
    if (!resp.ok) {
        let detail = '';
        try {
            const text = await resp.text();
            const match = text.match(/"message"\s*:\s*"([^"]+)"/);
            if (match) detail = ` (${match[1]})`;
        }
        catch { /* ignore */ }
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}${detail}`);
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

/** Strip the `https://openalex.org/` prefix if present so columns surface just the bare id. */
export function bareId(value) {
    const s = String(value ?? '').trim();
    if (!s) return '';
    return s.replace(/^https?:\/\/(?:api\.)?openalex\.org\//i, '').replace(/^works\//i, '');
}

/** Strip the `https://doi.org/` prefix so DOIs render as plain `10.…/…` strings. */
export function bareDoi(value) {
    const s = String(value ?? '').trim();
    if (!s) return '';
    return s.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
}

/**
 * Reconstruct a plain-text abstract from OpenAlex's
 * `abstract_inverted_index` (token → [positions]). OpenAlex returns the
 * abstract this way for licensing reasons.
 */
export function reconstructAbstract(invertedIndex) {
    if (!invertedIndex || typeof invertedIndex !== 'object') return '';
    const positions = [];
    for (const [token, idxs] of Object.entries(invertedIndex)) {
        if (!Array.isArray(idxs)) continue;
        for (const i of idxs) {
            if (Number.isInteger(i) && i >= 0 && i < 100000) {
                positions[i] = token;
            }
        }
    }
    return positions.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** Append the polite-pool `mailto` query param if the env var is set. */
export function appendMailto(url) {
    const mailto = process.env.OPENALEX_MAILTO?.trim();
    if (!mailto) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}mailto=${encodeURIComponent(mailto)}`;
}
