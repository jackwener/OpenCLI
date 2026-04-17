/**
 * arXiv adapter utilities.
 *
 * arXiv exposes a public Atom/XML API — no key required.
 * https://info.arxiv.org/help/api/index.html
 */
import { CliError } from '@jackwener/opencli/errors';
export const ARXIV_BASE = 'https://export.arxiv.org/api/query';
export async function arxivFetch(params) {
    const resp = await fetch(`${ARXIV_BASE}?${params}`);
    if (!resp.ok) {
        throw new CliError('FETCH_ERROR', `arXiv API HTTP ${resp.status}`, 'Check your search term or paper ID');
    }
    return resp.text();
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
/** Parse Atom XML feed into structured entries. */
export function parseEntries(xml) {
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    const entries = [];
    let m;
    while ((m = entryRe.exec(xml)) !== null) {
        const e = m[1];
        const rawId = extract(e, 'id');
        const arxivId = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
        entries.push({
            id: arxivId,
            title: extract(e, 'title').replace(/\s+/g, ' '),
            authors: extractAll(e, 'name').slice(0, 3).join(', '),
            abstract: (() => { const s = extract(e, 'summary').replace(/\s+/g, ' '); return s.length > 200 ? s.slice(0, 200) + '...' : s; })(),
            published: extract(e, 'published').slice(0, 10),
            url: `https://arxiv.org/abs/${arxivId}`,
        });
    }
    return entries;
}
