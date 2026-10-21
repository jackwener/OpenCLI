/**
 * arXiv adapter utilities.
 *
 * arXiv exposes a public Atom/XML API — no key required.
 * https://info.arxiv.org/help/api/index.html
 */
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
export const ARXIV_BASE = 'https://export.arxiv.org/api/query';
const ARXIV_CATEGORY_PATTERN = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)?$/;
export async function arxivFetch(params) {
    const resp = await fetch(`${ARXIV_BASE}?${params}`);
    if (!resp.ok) {
        throw new CommandExecutionError(`arXiv API HTTP ${resp.status}`, 'Check your search term or paper ID');
    }
    return resp.text();
}
export function normalizeArxivLimit(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError(`arxiv ${label} must be a positive integer`);
    }
    if (limit > maxValue) {
        throw new ArgumentError(`arxiv ${label} must be <= ${maxValue}`);
    }
    return limit;
}
export function normalizeArxivCategory(value) {
    const category = String(value || '').trim();
    if (!ARXIV_CATEGORY_PATTERN.test(category)) {
        throw new ArgumentError(`Invalid arXiv category "${value}". Examples: cs.CL, cs.LG, math.PR, q-bio.NC, physics.comp-ph`);
    }
    return category;
}
/** Decode the small set of XML entities arXiv emits in text fields. */
function decodeEntities(s) {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'");
}
/** Extract the text content of the first matching XML tag. */
function extract(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : '';
}
/** Extract all text contents of a repeated XML tag. */
function extractAll(xml, tag) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
    const results = [];
    let m;
    while ((m = re.exec(xml)) !== null)
        results.push(m[1].trim());
    return results;
}
/** Extract the value of a named attribute from the first matching tag (open or self-closing). */
function extractAttr(xml, tag, attr) {
    const m = xml.match(new RegExp(`<${tag}\\b[^>]*?\\b${attr}="([^"]*)"`));
    return m ? m[1] : '';
}
/** Extract all values of a named attribute across repeated tags. */
function extractAllAttr(xml, tag, attr) {
    const re = new RegExp(`<${tag}\\b[^>]*?\\b${attr}="([^"]*)"`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(xml)) !== null)
        out.push(m[1]);
    return out;
}
/** Find the href of the first <link> tag matching a given rel. */
function findLinkHref(xml, rel) {
    const re = /<link\b([^>]*)\/?>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const attrs = m[1];
        if (new RegExp(`\\brel="${rel}"`).test(attrs)) {
            const h = attrs.match(/\bhref="([^"]*)"/);
            if (h)
                return h[1];
        }
    }
    return '';
}
/** Parse Atom XML feed into structured entries. */
export function parseEntries(xml) {
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    const entries = [];
    let m;
    while ((m = entryRe.exec(xml)) !== null) {
        const e = m[1];
        const rawId = extract(e, 'id');
        const arxivId = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
        const pdf = findLinkHref(e, 'related') || `https://arxiv.org/pdf/${arxivId}`;
        entries.push({
            id: arxivId,
            title: decodeEntities(extract(e, 'title').replace(/\s+/g, ' ')),
            authors: decodeEntities(extractAll(e, 'name').join(', ')),
            abstract: decodeEntities(extract(e, 'summary').replace(/\s+/g, ' ')),
            published: extract(e, 'published').slice(0, 10),
            updated: extract(e, 'updated').slice(0, 10),
            primary_category: extractAttr(e, 'arxiv:primary_category', 'term'),
            categories: extractAllAttr(e, 'category', 'term').join(', '),
            comment: decodeEntities(extract(e, 'arxiv:comment').replace(/\s+/g, ' ')),
            pdf,
            url: `https://arxiv.org/abs/${arxivId}`,
        });
    }
    return entries;
}

// ── since / bibtex / pdf helpers ─────────────────────────────────────────────

/** arXiv reports the full match count for a query in <opensearch:totalResults>. */
export function parseTotalResults(xml) {
    const m = xml.match(/<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/);
    return m ? Number(m[1]) : 0;
}

// New-style IDs (2401.05779) and pre-2007 archive IDs (cs/0701001, hep-th/9901001),
// each optionally carrying a version suffix.
const ARXIV_ID_PATTERN = /^(?:\d{4}\.\d{4,5}|[A-Za-z][A-Za-z-]*(?:\.[A-Za-z]{2})?\/\d{7})(?:v\d+)?$/;

/** Validate an arXiv ID without silently repairing it. */
export function normalizeArxivId(value) {
    const id = String(value == null ? '' : value).trim();
    if (!ARXIV_ID_PATTERN.test(id)) {
        throw new ArgumentError('Invalid arXiv ID "' + value + '". Examples: 1706.03762, 1706.03762v7, cs/0701001');
    }
    return id;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const DEFAULT_LOOKBACK_DAYS = 7;

/** Parse YYYY-MM-DD as UTC midnight, rejecting impossible calendar dates. */
export function parseUtcDate(value, label) {
    const s = String(value == null ? '' : value).trim();
    if (!DATE_PATTERN.test(s)) {
        throw new ArgumentError(label + ' must be YYYY-MM-DD (UTC), got "' + value + '"');
    }
    const ms = Date.parse(s + 'T00:00:00Z');
    if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== s) {
        throw new ArgumentError(label + ' is not a real calendar date: "' + s + '"');
    }
    return ms;
}

/** YYYYMMDDHHMM — the GMT stamp format arXiv's submittedDate range expects. */
function toArxivStamp(ms, endOfDay) {
    const day = new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
    return day + (endOfDay ? '2359' : '0000');
}

/**
 * Resolve --days / --from / --to into an inclusive UTC window.
 * --days counts calendar days including today, so --days 1 means "today only".
 */
export function resolveSubmittedRange(options) {
    const opts = options || {};
    const daysRaw = opts.days;
    const fromRaw = opts.from;
    const toRaw = opts.to;
    const nowMs = opts.now == null ? Date.now() : opts.now;

    const present = (v) => v !== undefined && v !== null && String(v).trim() !== '';
    const hasDays = present(daysRaw);
    const hasFrom = present(fromRaw);
    const hasTo = present(toRaw);

    if (hasDays && (hasFrom || hasTo)) {
        throw new ArgumentError('Use either --days or --from/--to, not both');
    }

    const todayMs = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + 'T00:00:00Z');
    let fromMs;
    let toMs;
    let windowLabel;

    if (hasFrom || hasTo) {
        toMs = hasTo ? parseUtcDate(toRaw, '--to') : todayMs;
        fromMs = hasFrom ? parseUtcDate(fromRaw, '--from') : toMs;
        if (fromMs > toMs) {
            throw new ArgumentError('--from (' + new Date(fromMs).toISOString().slice(0, 10) + ') must not be after --to (' + new Date(toMs).toISOString().slice(0, 10) + ')');
        }
        windowLabel = new Date(fromMs).toISOString().slice(0, 10) + '..' + new Date(toMs).toISOString().slice(0, 10);
    }
    else {
        let days = DEFAULT_LOOKBACK_DAYS;
        if (hasDays) {
            days = Number(daysRaw);
            if (!Number.isInteger(days) || days <= 0) {
                throw new ArgumentError('--days must be a positive integer');
            }
        }
        toMs = todayMs;
        fromMs = todayMs - (days - 1) * DAY_MS;
        windowLabel = 'last ' + days + ' day(s)';
    }

    const from = toArxivStamp(fromMs, false);
    const to = toArxivStamp(toMs, true);
    return {
        from: from,
        to: to,
        fromDate: new Date(fromMs).toISOString().slice(0, 10),
        toDate: new Date(toMs).toISOString().slice(0, 10),
        windowLabel: windowLabel,
        // arXiv wants the raw bracketed value inside search_query; the caller encodes once.
        range: 'submittedDate:[' + from + ' TO ' + to + ']',
    };
}

// ── BibTeX (arxiv.org/bibtex/<id>) ───────────────────────────────────────────

export const ARXIV_BIBTEX_BASE = 'https://arxiv.org/bibtex/';

/** Fetch the BibTeX record arXiv renders for an ID, mapping its error codes. */
export async function fetchArxivBibtex(id) {
    const url = ARXIV_BIBTEX_BASE + encodeURIComponent(id);
    let resp;
    try {
        resp = await fetch(url, { headers: { Accept: 'text/plain,*/*' } });
    }
    catch (err) {
        throw new CommandExecutionError('arXiv bibtex request failed: ' + (err && err.message ? err.message : String(err)));
    }
    if (resp.status === 400) {
        throw new ArgumentError('arXiv rejected "' + id + '" as a bad_id. Examples: 1706.03762, 1706.03762v7, cs/0701001');
    }
    if (resp.status === 404) {
        throw new EmptyResultError('arxiv bibtex', 'No BibTeX record for ' + id + '. Verify the ID with "opencli arxiv paper ' + id + '".');
    }
    if (!resp.ok) {
        throw new CommandExecutionError('arXiv bibtex HTTP ' + resp.status + ' for ' + id);
    }
    const text = (await resp.text()).trim();
    if (text.charAt(0) !== '@') {
        throw new CommandExecutionError('arXiv bibtex returned a non-BibTeX payload for ' + id);
    }
    return { bibtex: text, url: url };
}

/** Parse a single BibTeX entry into its cite key and fields (null when unparseable). */
export function parseBibtexEntry(text) {
    const head = text.match(/@([A-Za-z]+)\s*\{\s*([^,\s{}]+)\s*,/);
    if (!head) {
        return null;
    }
    const fields = {};
    const fieldRe = /^\s*([A-Za-z]+)\s*=\s*\{([\s\S]*?)\}\s*,?\s*$/gm;
    let m;
    while ((m = fieldRe.exec(text)) !== null) {
        fields[m[1].toLowerCase()] = m[2].replace(/\s+/g, ' ').trim();
    }
    return { entryType: head[1], citeKey: head[2], fields: fields };
}

