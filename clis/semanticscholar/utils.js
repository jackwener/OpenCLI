// Shared helpers for the Semantic Scholar (`api.semanticscholar.org`) adapter.
//
// Semantic Scholar exposes a free Academic Graph + a separate Recommendations
// API. Anonymous traffic caps at roughly 100 requests / 5 minutes; an optional
// API key (free at https://www.semanticscholar.org/product/api#api-key-form)
// lifts the limit and is passed via `SEMANTIC_SCHOLAR_API_KEY`. Paper refs
// accept Semantic Scholar paperIds, DOIs, arXiv ids, ACL ids, MAG ids, PMID,
// or full URLs; they round-trip through `paper <ref>` to `citations <ref>`
// and `recommendations <ref>`.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const S2_GRAPH_BASE = 'https://api.semanticscholar.org/graph/v1';
export const S2_REC_BASE = 'https://api.semanticscholar.org/recommendations/v1';
const UA = 'opencli-semanticscholar-adapter (+https://github.com/jackwener/opencli)';

// Semantic Scholar paperId: 40-char lowercase hex (SHA-ish).
const S2_PAPER_ID = /^[0-9a-f]{40}$/i;
// DOIs: anything starting with 10. after an optional `doi:` / `doi.org/` prefix.
const DOI_BARE = /^10\.\S+$/;
// arXiv ids: modern `YYMM.NNNNN` form or legacy `archive/YYMMNNN`.
const ARXIV_MODERN = /^\d{4}\.\d{4,5}(?:v\d+)?$/;
const ARXIV_LEGACY = /^[a-z-]+\/\d{7}(?:v\d+)?$/i;
// Other Semantic Scholar accepted prefixes that we pass through verbatim.
const PREFIXED = /^(ARXIV|MAG|ACL|PMID|PMCID|URL|CorpusId|DBLP):/i;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) {
        throw new ArgumentError(`semanticscholar ${label} cannot be empty`);
    }
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`semanticscholar ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`semanticscholar ${label} must be <= ${maxValue}`);
    }
    return n;
}

/**
 * Resolve a user-supplied paper reference to a Semantic Scholar paper id
 * segment. Accepts:
 *
 *   - bare Semantic Scholar paperId (40-char hex)
 *   - DOI (with or without `doi:` / `https://doi.org/` prefix)
 *   - arXiv id (`1706.03762` / `1706.03762v3` / `cs/0501067`)
 *   - typed prefixes Semantic Scholar accepts verbatim (`ARXIV:`, `MAG:`,
 *     `ACL:`, `PMID:`, `PMCID:`, `URL:`, `CorpusId:`, `DBLP:`)
 *   - full `https://www.semanticscholar.org/paper/<paperId>` URL
 */
export function requirePaperRef(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ArgumentError(
            'semanticscholar paper id cannot be empty',
            'Example: opencli semanticscholar paper 10.18653/v1/N19-1423',
        );
    }
    const s2Url = raw.match(/^https?:\/\/(?:www\.)?semanticscholar\.org\/paper\/(?:[^/]+\/)?([0-9a-f]{40})/i);
    if (s2Url) return s2Url[1].toLowerCase();
    if (S2_PAPER_ID.test(raw)) return raw.toLowerCase();
    if (PREFIXED.test(raw)) return raw;
    if (/^doi:/i.test(raw)) {
        const doi = raw.replace(/^doi:/i, '').trim();
        if (DOI_BARE.test(doi)) return `DOI:${doi}`;
    }
    const doiUrl = raw.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
    if (doiUrl && DOI_BARE.test(doiUrl[1])) return `DOI:${doiUrl[1]}`;
    if (DOI_BARE.test(raw)) return `DOI:${raw}`;
    if (ARXIV_MODERN.test(raw) || ARXIV_LEGACY.test(raw)) return `ARXIV:${raw}`;
    throw new ArgumentError(
        `semanticscholar paper id "${value}" is not recognised`,
        'Use a Semantic Scholar paperId, a DOI, an arXiv id, or a prefixed id (e.g. "ARXIV:1706.03762", "PMID:12345").',
    );
}

/**
 * Fetch with optional `SEMANTIC_SCHOLAR_API_KEY` header. Retries once on 429
 * after a short pause; anonymous traffic hits the public ~100 req / 5 min
 * cap, and a single retry covers the typical burst-then-cool-down case.
 */
export async function s2Fetch(url, label) {
    const headers = { 'user-agent': UA, accept: 'application/json' };
    const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
    if (apiKey) headers['x-api-key'] = apiKey;

    let resp;
    let attempt = 0;
    while (true) {
        try {
            resp = await fetch(url, { headers });
        } catch (err) {
            throw new CommandExecutionError(
                `${label} request failed: ${err?.message ?? err}`,
                'Check that api.semanticscholar.org is reachable from this network.',
            );
        }
        if (resp.status === 429 && attempt === 0 && !apiKey) {
            attempt += 1;
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
        }
        break;
    }

    if (resp.status === 404) {
        throw new EmptyResultError(label, `Semantic Scholar returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Semantic Scholar throttles anonymous traffic; set SEMANTIC_SCHOLAR_API_KEY (free at https://www.semanticscholar.org/product/api) or wait a minute and retry.',
        );
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }
    let body;
    try {
        body = await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
    if (body && typeof body === 'object' && body.error) {
        throw new CommandExecutionError(`${label} returned an error: ${body.error}`);
    }
    return body;
}

/** Return the AI-generated one-line summary if present, else ''. */
export function tldrText(tldr) {
    if (tldr && typeof tldr === 'object' && typeof tldr.text === 'string') {
        return tldr.text.trim();
    }
    return '';
}

/** First author display name, or '' when authors is missing. */
export function firstAuthorName(authors) {
    if (!Array.isArray(authors) || !authors.length) return '';
    const first = authors[0];
    if (first && typeof first === 'object' && typeof first.name === 'string') {
        return first.name.trim();
    }
    return '';
}

export function optionalNumber(value, label) {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new CommandExecutionError(`semanticscholar ${label} must be a number when present`);
    }
    return value;
}

export function normalizePaperRow(paper, label, { rank } = {}) {
    if (!paper || typeof paper !== 'object') {
        throw new CommandExecutionError(`semanticscholar ${label} row is not an object`);
    }
    if (typeof paper.paperId !== 'string' || !paper.paperId.trim()) {
        throw new CommandExecutionError(`semanticscholar ${label} row is missing paperId`);
    }
    if (typeof paper.title !== 'string' || !paper.title.trim()) {
        throw new CommandExecutionError(`semanticscholar ${label} row is missing title`);
    }
    if (paper.authors != null && !Array.isArray(paper.authors)) {
        throw new CommandExecutionError(`semanticscholar ${label} row has malformed authors`);
    }
    const row = {
        paperId: paper.paperId.trim(),
        doi: pickDoi(paper.externalIds),
        title: paper.title.trim(),
        year: optionalNumber(paper.year, `${label} year`),
        firstAuthor: firstAuthorName(paper.authors),
        citationCount: optionalNumber(paper.citationCount, `${label} citationCount`),
        url: typeof paper.url === 'string' && paper.url.trim()
            ? paper.url.trim()
            : `https://www.semanticscholar.org/paper/${paper.paperId.trim()}`,
    };
    if (rank != null) return { rank, ...row };
    return row;
}

/** Strip the typed prefix from `externalIds.DOI` and similar. */
export function pickDoi(externalIds) {
    if (externalIds && typeof externalIds === 'object' && typeof externalIds.DOI === 'string') {
        return externalIds.DOI;
    }
    return '';
}
