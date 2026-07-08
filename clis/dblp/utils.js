/**
 * DBLP adapter utilities.
 *
 * dblp serves a public, unauthenticated API:
 *   - Publication search (JSON):
 *     `https://dblp.org/search/publ/api?q=<query>&format=json&h=<limit>`
 *   - Per-record metadata (XML):
 *     `https://dblp.org/rec/<key>.xml`
 *
 * The search response is well-shaped JSON, but the per-record endpoint is
 * XML. We parse it with conservative regexes (same pattern as the arxiv
 * adapter) to avoid pulling in an XML lib for this single endpoint.
 */
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const DBLP_ORIGIN = 'https://dblp.org';

/**
 * dblp record keys look like `<type>/<venue>/<short>` (e.g.
 * `conf/nips/VaswaniSPUJGKP17`, `journals/corr/abs-2509-05821`,
 * `phd/Smith20`). Allow lowercase letter prefixes plus 1+ slash-segments
 * containing letters / digits / `_` / `.` / `-`.
 */
const KEY_PATTERN = /^[a-z]+(?:\/[A-Za-z0-9_.-]+)+$/;

/**
 * Wraps `fetch` with typed errors. We always set a UA per dblp's
 * polite-fetch guidance (https://dblp.org/faq/How+to+use+the+dblp+search+API.html).
 */
async function dblpFetch(url, label, accept) {
    let res;
    try {
        res = await fetch(url, {
            headers: {
                accept,
                'user-agent': 'opencli-dblp/1.0 (+https://github.com/jackwener/opencli)',
            },
        });
    }
    catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err?.message ?? err}`, 'Check that dblp.org is reachable from this network.');
    }
    if (!res.ok) {
        if (res.status === 429) {
            throw new CommandExecutionError(`${label} returned HTTP 429 (rate limited)`, 'dblp throttles clients that fetch too aggressively. Wait a few seconds and retry, or lower --limit.');
        }
        if (res.status === 404) {
            throw new EmptyResultError(label, 'dblp returned 404 — the requested record may not exist.');
        }
        throw new CommandExecutionError(`${label} returned HTTP ${res.status}`, 'Inspect the response in a browser at the same URL for more context.');
    }
    return res;
}

export async function dblpFetchJson(path, label) {
    const res = await dblpFetch(`${DBLP_ORIGIN}${path}`, label, 'application/json');
    let body;
    try {
        body = await res.json();
    }
    catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
    const statusCode = String(body?.result?.status?.['@code'] ?? '').trim();
    if (!statusCode) {
        throw new CommandExecutionError(
            `${label} returned JSON without result.status.@code`,
            'dblp changed its JSON envelope or returned a partial error payload; inspect the raw response in a browser.',
        );
    }
    if (statusCode !== '200') {
        const statusText = String(body?.result?.status?.text ?? '').trim();
        throw new CommandExecutionError(
            `${label} returned API status ${statusCode}${statusText ? ` (${statusText})` : ''}`,
            'dblp accepted the HTTP request but reported an API-level failure. Retry later or inspect the same query in a browser.',
        );
    }
    return body;
}

export async function dblpFetchXml(path, label) {
    const res = await dblpFetch(`${DBLP_ORIGIN}${path}`, label, 'application/xml');
    return res.text();
}

export function coerceInt(value) {
    if (value === undefined || value === null || value === '') return NaN;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && Number.isInteger(n) ? n : NaN;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = coerceInt(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`dblp ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`dblp ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireQuery(value, label = 'query') {
    const q = String(value ?? '').trim();
    if (!q) {
        throw new ArgumentError(`dblp ${label} cannot be empty`);
    }
    return q;
}

export function requireRecordKey(value) {
    const key = String(value ?? '').trim();
    if (!key) {
        throw new ArgumentError('dblp paper key is required');
    }
    if (!KEY_PATTERN.test(key)) {
        throw new ArgumentError(`dblp paper key "${value}" is not a valid record key`, 'Expected something like "conf/nips/VaswaniSPUJGKP17" — copy the `key` column from `dblp search`.');
    }
    return key;
}

/** Decode the small set of XML entities dblp emits in record bodies. */
export function decodeXmlEntities(text) {
    if (!text) return '';
    return String(text)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

/** Strip dblp's per-author homonym suffixes (`Smith 0001`) → `Smith`. */
function trimAuthorHomonym(name) {
    return String(name || '').replace(/\s+\d{4,}$/, '').trim();
}

/**
 * Normalize the `info.authors.author` field from a dblp search hit. dblp
 * collapses single authors into one object instead of a 1-element array.
 */
export function normalizeAuthors(authorsField) {
    if (!authorsField) return [];
    const raw = authorsField?.author;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((a) => {
        if (a && typeof a === 'object') return trimAuthorHomonym(a.text || a['#text'] || '');
        return trimAuthorHomonym(String(a));
    }).filter(Boolean);
}

/**
 * Project a dblp publication search hit into one row. Drops only the most
 * volatile fields (e.g. abstract, which dblp does not expose) and keeps
 * the canonical key as the round-trip handle.
 */
export function searchHitToRow(hit, rank) {
    const info = hit?.info ?? {};
    const authors = normalizeAuthors(info.authors);
    const key = String(info.key ?? '').trim();
    return {
        rank,
        key,
        title: stripTrailingDot(decodeXmlEntities(info.title ?? '')).trim(),
        authors: authors.join(', '),
        venue: decodeXmlEntities(info.venue ?? ''),
        year: String(info.year ?? '').trim(),
        type: simplifyHitType(info.type),
        doi: String(info.doi ?? '').trim(),
        url: String(info.ee ?? info.url ?? '').trim(),
    };
}

/** Title strings from dblp end with a period — strip it for cleaner display. */
function stripTrailingDot(s) {
    return String(s || '').replace(/\.\s*$/, '');
}

/** Compress dblp's verbose `type` strings into single-token tags. */
function simplifyHitType(type) {
    if (!type) return '';
    const t = String(type);
    if (/Conference and Workshop/i.test(t)) return 'conf';
    if (/Journal Articles/i.test(t)) return 'journal';
    if (/Books and Theses/i.test(t)) return 'book';
    if (/Editorship/i.test(t)) return 'editorship';
    if (/Reference Works/i.test(t)) return 'reference';
    if (/Informal/i.test(t)) return 'preprint';
    return t.toLowerCase().split(/\s+/)[0];
}

/**
 * Extract a single tag from a dblp record XML blob (regex-based, same
 * approach as arxiv/utils.js — keeps the dependency surface flat).
 */
export function extractFirst(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1] : '';
}

export function extractAll(xml, tag) {
    const out = [];
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
    let m;
    while ((m = re.exec(String(xml || ''))) !== null) out.push(m[1]);
    return out;
}

/**
 * Pick the first `<ee type="oa">` (open-access link) if present, otherwise
 * fall back to the first `<ee>`.
 */
export function extractOpenAccessLink(xml) {
    const oa = String(xml || '').match(/<ee\b[^>]*type=["']oa["'][^>]*>([\s\S]*?)<\/ee>/);
    if (oa) return oa[1].trim();
    const any = String(xml || '').match(/<ee\b[^>]*>([\s\S]*?)<\/ee>/);
    return any ? any[1].trim() : '';
}

/** Pull the `key` attribute off the wrapper element regardless of record type. */
export function extractRecordKey(xml) {
    const m = String(xml || '').match(/<(?:article|inproceedings|incollection|proceedings|book|phdthesis|mastersthesis)\b[^>]*\bkey="([^"]+)"/);
    return m ? m[1] : '';
}

/**
 * Identify the record type from the wrapper element name. Maps to the
 * same simplified tag set the search rows use.
 */
export function extractRecordType(xml) {
    const m = String(xml || '').match(/<(article|inproceedings|incollection|proceedings|book|phdthesis|mastersthesis)\b/);
    if (!m) return '';
    switch (m[1]) {
        case 'inproceedings': return 'conf';
        case 'article': return 'journal';
        case 'incollection': return 'incollection';
        case 'proceedings': return 'editorship';
        case 'book': return 'book';
        case 'phdthesis': return 'phdthesis';
        case 'mastersthesis': return 'mastersthesis';
        default: return m[1];
    }
}

/**
 * Parse a single dblp record XML into the row shape used by `dblp paper`.
 * Treats every field as optional; throws upstream when the record body
 * is missing entirely (404 already handled at fetch level).
 */
export function recordXmlToRow(xml) {
    const key = extractRecordKey(xml);
    const type = extractRecordType(xml);
    const title = stripTrailingDot(decodeXmlEntities(extractFirst(xml, 'title')));
    const authors = extractAll(xml, 'author').map((a) => trimAuthorHomonym(decodeXmlEntities(a)));
    const year = decodeXmlEntities(extractFirst(xml, 'year'));
    const pages = decodeXmlEntities(extractFirst(xml, 'pages'));
    const venueRaw = type === 'conf'
        ? decodeXmlEntities(extractFirst(xml, 'booktitle'))
        : decodeXmlEntities(extractFirst(xml, 'journal'));
    const doi = (() => {
        const m = String(xml || '').match(/<ee\b[^>]*>([^<]*?(?:doi\.org\/|10\.[^"<]+))<\/ee>/i);
        if (!m) return '';
        const v = m[1].replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
        return v.startsWith('10.') ? v : '';
    })();
    return {
        key,
        type,
        title,
        authors: authors.join(', '),
        venue: venueRaw,
        year,
        pages,
        doi,
        open_access_url: extractOpenAccessLink(xml),
        dblp_url: key ? `${DBLP_ORIGIN}/rec/${key}.html` : '',
    };
}

export const SEARCH_COLUMNS = [
    'rank', 'key', 'title', 'authors', 'venue', 'year', 'type', 'doi', 'url',
];

export const PAPER_COLUMNS = [
    'key', 'type', 'title', 'authors', 'venue', 'year', 'pages', 'doi', 'open_access_url', 'dblp_url',
];
