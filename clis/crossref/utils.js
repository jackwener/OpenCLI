// Shared helpers for the Crossref adapters.
//
// Hits the public, unauthenticated `api.crossref.org` REST endpoints — the
// canonical DOI / scholarly metadata registry. Crossref encourages a polite
// User-Agent + contact email so they can route abusers; we set one without
// requiring users to register.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const CROSSREF_BASE = 'https://api.crossref.org';
const UA = 'opencli-crossref-adapter/1.0 (+https://github.com/jackwener/opencli; mailto:opencli@example.com)';

// DOI registrant + suffix is intentionally permissive (RFC 3986 unreserved + `/`).
// Crossref handles its own normalisation; we just guard against obvious junk.
const DOI_PATTERN = /^10\.\d{4,9}\/[^\s]+$/;
// ISSN is 7 digits + check char (digit or `X`), typically rendered as `NNNN-NNNN`.
const ISSN_PATTERN = /^\d{4}-\d{3}[\dXx]$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`crossref ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`crossref ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`crossref ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireDoi(value) {
    const raw = String(value ?? '').trim();
    if (!raw) throw new ArgumentError('crossref doi is required (e.g. "10.1038/nature12373")');
    // Trim courtesy prefixes users often paste from URLs.
    const stripped = raw
        .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
        .replace(/^doi:/i, '');
    if (!DOI_PATTERN.test(stripped)) {
        throw new ArgumentError(
            `crossref doi "${value}" is not a valid DOI`,
            'Expected format: "10.<registrant>/<suffix>" (e.g. "10.1038/nature12373").',
        );
    }
    return stripped;
}

export function requireIssn(value) {
    const raw = String(value ?? '').trim().toUpperCase();
    if (!raw) throw new ArgumentError('crossref issn is required (e.g. "2167-8359")');
    if (!ISSN_PATTERN.test(raw)) {
        throw new ArgumentError(
            `crossref issn "${value}" is not a valid ISSN`,
            'Expected format: "NNNN-NNNN" with 7 digits + checksum (digit or X).',
        );
    }
    return raw;
}

/** Flatten a Crossref date-parts array `[[YYYY, M, D]]` → `YYYY-MM-DD`. */
export function joinDateParts(dateField) {
    const parts = Array.isArray(dateField?.['date-parts']) ? dateField['date-parts'][0] : null;
    if (!Array.isArray(parts) || parts.length === 0) return null;
    const [y, m, d] = parts;
    if (typeof y !== 'number') return null;
    const pad = (n) => String(n).padStart(2, '0');
    if (typeof m !== 'number') return String(y);
    if (typeof d !== 'number') return `${y}-${pad(m)}`;
    return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Extract first non-empty published date across `published-print`, `published-online`,
 * `issued`, `created`. Crossref records may have any subset; pick what's available.
 */
export function extractPublished(item) {
    const candidates = [item?.['published-print'], item?.['published-online'], item?.issued, item?.created];
    for (const c of candidates) {
        const d = joinDateParts(c);
        if (d) return d;
    }
    return null;
}

export function formatAuthors(authors, maxNames = 6) {
    if (!Array.isArray(authors)) return '';
    const names = authors
        .filter((a) => a && (a.family || a.given || a.name))
        .map((a) => {
            if (a.name) return String(a.name).trim();
            const parts = [a.given, a.family].filter((p) => p != null && String(p).trim());
            return parts.join(' ').trim();
        })
        .filter(Boolean);
    if (names.length === 0) return '';
    if (names.length > maxNames) {
        return [...names.slice(0, maxNames), `et al. (+${names.length - maxNames})`].join(', ');
    }
    return names.join(', ');
}

export function pickTitle(item) {
    const t = Array.isArray(item?.title) ? item.title[0] : item?.title;
    return typeof t === 'string' ? t.trim() : '';
}

export function pickContainer(item) {
    const c = Array.isArray(item?.['container-title']) ? item['container-title'][0] : item?.['container-title'];
    return typeof c === 'string' ? c.trim() : '';
}

export async function crossrefFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api.crossref.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Crossref returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Crossref throttles unauthenticated traffic; wait a few seconds and retry.',
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
