/**
 * Indeed adapter utilities.
 *
 * Indeed sits behind Cloudflare and answers bare fetches with HTTP 403
 * (`cf-mitigated: challenge`). The whole adapter therefore runs through a
 * real browser session (Strategy.COOKIE), and DOM extraction lives inside
 * `page.evaluate` blocks. The helpers below are mostly arg-validation +
 * pure normalizers so they stay unit-testable without a browser.
 */

import { ArgumentError } from '@jackwener/opencli/errors';

export const INDEED_ORIGIN = 'https://www.indeed.com';

/** Job key (jk) shape — 16-char lowercase hex. */
const JK_PATTERN = /^[a-f0-9]{16}$/;

const FROMAGE_VALUES = new Set(['1', '3', '7', '14']);

const SORT_VALUES = new Set(['relevance', 'date']);

/**
 * Coerce a value to a strict integer. Accepts numeric strings, rejects
 * floats / non-numeric / NaN. Returns NaN on invalid input so callers can
 * decide on the right typed error.
 */
export function coerceInt(value) {
    if (value === undefined || value === null || value === '') return NaN;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && Number.isInteger(n) ? n : NaN;
}

export function requireBoundedInt(value, defaultValue, maxValue, label) {
    const raw = value ?? defaultValue;
    const n = coerceInt(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`indeed ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`indeed ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireNonNegativeInt(value, defaultValue, label) {
    const raw = value ?? defaultValue;
    const n = coerceInt(raw);
    if (!Number.isInteger(n) || n < 0) {
        throw new ArgumentError(`indeed ${label} must be a non-negative integer`);
    }
    return n;
}

export function requireJobKey(value) {
    const id = String(value ?? '').trim().toLowerCase();
    if (!id) {
        throw new ArgumentError('indeed job id is required');
    }
    if (!JK_PATTERN.test(id)) {
        throw new ArgumentError(`indeed job id "${value}" is not a valid jk (expected 16-char lowercase hex)`);
    }
    return id;
}

export function requireQuery(value, label = 'query') {
    const q = String(value ?? '').trim();
    if (!q) {
        throw new ArgumentError(`indeed ${label} cannot be empty`);
    }
    return q;
}

/** "1" / "3" / "7" / "14" — accepted by Indeed's `fromage` filter. */
export function requireFromage(value) {
    if (value === undefined || value === null || value === '') return '';
    const v = String(value).trim();
    if (!FROMAGE_VALUES.has(v)) {
        throw new ArgumentError(`indeed fromage must be one of 1/3/7/14 (days), got "${value}"`);
    }
    return v;
}

export function requireSort(value, defaultValue = 'relevance') {
    const v = String(value ?? defaultValue).trim().toLowerCase();
    if (!SORT_VALUES.has(v)) {
        throw new ArgumentError(`indeed sort must be "relevance" or "date", got "${value}"`);
    }
    return v;
}

/**
 * Build an Indeed search URL with only the user-supplied filters set.
 * Indeed treats absent params as defaults; we never pass empty strings
 * because the page will echo them back into the query and the URL
 * stays cleaner for round-tripping.
 */
export function buildSearchUrl({ query, location, fromage, sort, start }) {
    const params = new URLSearchParams();
    params.set('q', query);
    if (location) params.set('l', location);
    if (fromage) params.set('fromage', fromage);
    if (sort && sort !== 'relevance') params.set('sort', sort);
    if (start && start > 0) params.set('start', String(start));
    return `${INDEED_ORIGIN}/jobs?${params.toString()}`;
}

export function buildJobUrl(jk) {
    return `${INDEED_ORIGIN}/viewjob?jk=${jk}`;
}

/** Strip a salary-snippet duplicate out of the metadata pill list. */
export function dedupeTags(tags, salary) {
    const out = [];
    for (const t of tags) {
        const trimmed = String(t || '').trim();
        if (!trimmed) continue;
        if (salary && trimmed === salary) continue;
        if (out.includes(trimmed)) continue;
        out.push(trimmed);
    }
    return out.join(' · ');
}

/**
 * Normalize a parsed search-card object into the row shape declared by
 * `SEARCH_COLUMNS`. Drops nulls into empty strings, defends against
 * Indeed surface drift by treating missing fields as empty rather than
 * silently mislabeling them.
 */
export function searchCardToRow(card, rank) {
    const jk = String(card?.jk ?? '').trim();
    const salary = String(card?.salary ?? '').trim();
    const tags = Array.isArray(card?.tags) ? card.tags : [];
    return {
        rank,
        id: jk,
        title: String(card?.title ?? '').replace(/\s+/g, ' ').trim(),
        company: String(card?.company ?? '').replace(/\s+/g, ' ').trim(),
        location: String(card?.location ?? '').replace(/\s+/g, ' ').trim(),
        salary,
        tags: dedupeTags(tags, salary),
        url: jk ? buildJobUrl(jk) : '',
    };
}

export const SEARCH_COLUMNS = [
    'rank', 'id', 'title', 'company', 'location', 'salary', 'tags', 'url',
];

export const JOB_COLUMNS = [
    'id', 'title', 'company', 'location', 'salary', 'job_type', 'description', 'url',
];
