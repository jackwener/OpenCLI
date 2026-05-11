/**
 * arXiv adapter utilities.
 *
 * arXiv exposes a public Atom/XML API — no key required.
 * https://info.arxiv.org/help/api/index.html
 */
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
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
