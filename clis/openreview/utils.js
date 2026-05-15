/**
 * OpenReview adapter utilities.
 *
 * Public OpenReview v2 API — no key required for everyone-readable notes.
 * https://docs.openreview.net/reference/api-v2
 */
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export const OPENREVIEW_API = 'https://api2.openreview.net';
export const OPENREVIEW_BASE = 'https://openreview.net';

/** Forum / note IDs on OpenReview are short URL-safe slugs (typically 10 chars). */
const ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;

/**
 * Coerce a value to a strict integer (accepts numeric strings, rejects
 * floats / non-numeric / NaN). Returns NaN on invalid input so callers can
 * decide on the right typed error.
 */
export function coerceInt(value) {
    if (value === undefined || value === null || value === '') return NaN;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && Number.isInteger(n) ? n : NaN;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = coerceInt(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`openreview ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`openreview ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireNonNegativeInt(value, defaultValue, label = 'offset') {
    const raw = value ?? defaultValue;
    const n = coerceInt(raw);
    if (!Number.isInteger(n) || n < 0) {
        throw new ArgumentError(`openreview ${label} must be a non-negative integer`);
    }
    return n;
}

export function requireForumId(value, label = 'id') {
    const id = String(value ?? '').trim();
    if (!id) {
        throw new ArgumentError(`openreview ${label} is required`);
    }
    if (!ID_PATTERN.test(id)) {
        throw new ArgumentError(`openreview ${label} "${value}" is not a valid forum id (expected 6-20 chars of [A-Za-z0-9_-])`);
    }
    return id;
}

/** OpenReview profile ids are `~...N` slugs and may include dots, hyphens, and Unicode letters. */
const PROFILE_ID_PATTERN = /^~(?=.*\p{L})[\p{L}\p{M}0-9._-]+\d+$/u;

export function requireProfileId(value, label = 'profile') {
    const id = String(value ?? '').trim();
    if (!id) {
        throw new ArgumentError(`openreview ${label} is required`);
    }
    if (!PROFILE_ID_PATTERN.test(id)) {
        throw new ArgumentError(`openreview ${label} "${value}" is not a valid profile id (expected "~First_Last1" or similar; find it on the author's openreview.net profile URL)`);
    }
    return id;
}

/** Wrap fetch + json with typed errors so failures never look like empty results. */
export async function openreviewFetch(path, label) {
    const url = `${OPENREVIEW_API}${path}`;
    let resp;
    try {
        resp = await fetch(url);
    }
    catch (e) {
        throw new CommandExecutionError(`Network failure fetching ${label}: ${e?.message ?? e}`, 'Check your network connection and try again.');
    }
    if (resp.status === 404) {
        return null;
    }
    if (!resp.ok) {
        let body = '';
        try { body = (await resp.text()).slice(0, 200); } catch {}
        throw new CommandExecutionError(`OpenReview API HTTP ${resp.status} for ${label}${body ? ` (${body})` : ''}`, 'The OpenReview API may be down or rate-limiting.');
    }
    let json;
    try {
        json = await resp.json();
    }
    catch (e) {
        throw new CommandExecutionError(`Malformed JSON from OpenReview for ${label}: ${e?.message ?? e}`, 'Try again or report this as an OpenReview API bug.');
    }
    const envelopeErrors = Array.isArray(json?.errors) ? json.errors.filter(Boolean) : [];
    const envelopeError = typeof json?.error === 'string' ? json.error.trim() : '';
    if (envelopeErrors.length || envelopeError) {
        const detail = envelopeError || envelopeErrors.map((entry) => {
            if (typeof entry === 'string') return entry;
            if (entry?.message) return String(entry.message);
            return JSON.stringify(entry);
        }).join('; ');
        throw new CommandExecutionError(`OpenReview API error for ${label}: ${detail}`, 'The OpenReview API returned an application-level error.');
    }
    return json;
}

/** Format ms-since-epoch as YYYY-MM-DD; empty string for invalid input. */
export function formatDate(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
    return new Date(ms).toISOString().slice(0, 10);
}

/** Read a v2 content field, which is wrapped as `{ value: ... }`. */
export function readContent(content, key) {
    const v = content?.[key]?.value;
    if (v === undefined || v === null) return undefined;
    return v;
}

/** Build an absolute PDF URL from the `content.pdf` value, which may be a relative `/pdf/<hash>.pdf`. */
export function absolutePdf(pdfValue) {
    const v = String(pdfValue ?? '').trim();
    if (!v) return '';
    if (/^https?:\/\//.test(v)) return v;
    if (v.startsWith('/')) return `${OPENREVIEW_BASE}${v}`;
    return `${OPENREVIEW_BASE}/${v}`;
}

/** Strip `~` markers and trailing digits from author IDs (e.g. `~John_Doe1` → `John Doe`). */
function authorIdToName(authorid) {
    return String(authorid || '')
        .replace(/^~/, '')
        .replace(/\d+$/, '')
        .replace(/_/g, ' ')
        .trim();
}

/**
 * Map a v2 note (submission or paper) to a flat row.
 * `content.authors` is preferred; falls back to author IDs if missing.
 */
export function noteToRow(note) {
    const c = note?.content ?? {};
    const id = note?.id ?? '';
    const authors = readContent(c, 'authors');
    const authorIds = readContent(c, 'authorids');
    let authorList = '';
    if (Array.isArray(authors) && authors.length) {
        authorList = authors.join(', ');
    }
    else if (Array.isArray(authorIds) && authorIds.length) {
        authorList = authorIds.map(authorIdToName).join(', ');
    }
    const keywords = readContent(c, 'keywords');
    const keywordList = Array.isArray(keywords) ? keywords.join(', ') : String(keywords ?? '');
    return {
        id,
        title: String(readContent(c, 'title') ?? '').replace(/\s+/g, ' ').trim(),
        authors: authorList,
        keywords: keywordList,
        venue: String(readContent(c, 'venue') ?? '').trim(),
        venueid: String(readContent(c, 'venueid') ?? '').trim(),
        primary_area: String(readContent(c, 'primary_area') ?? '').trim(),
        abstract: String(readContent(c, 'abstract') ?? '').replace(/\s+/g, ' ').trim(),
        pdate: formatDate(note?.pdate ?? note?.cdate),
        pdf: absolutePdf(readContent(c, 'pdf')),
        url: id ? `${OPENREVIEW_BASE}/forum?id=${id}` : '',
    };
}
