// crossref work — fetch full Crossref metadata for a single DOI.
//
// Hits `https://api.crossref.org/works/<doi>`. Returns the agent-useful
// projection: title, authors (full list), container, publisher, type,
// published date, abstract (when registered), citation count, references count,
// license info, and links back to doi.org / crossref.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CROSSREF_BASE,
    crossrefFetch,
    extractPublished,
    formatAuthors,
    pickContainer,
    pickTitle,
    requireDoi,
} from './utils.js';

function stripHtml(value) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

cli({
    site: 'crossref',
    name: 'work',
    access: 'read',
    description: 'Fetch full Crossref metadata for a DOI',
    domain: 'api.crossref.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'doi', positional: true, required: true, help: 'DOI (e.g. "10.1038/nature12373"; "doi:" / "https://doi.org/" prefixes accepted)' },
    ],
    columns: [
        'doi', 'title', 'authors', 'container', 'publisher', 'type', 'published',
        'pages', 'volume', 'issue', 'issn', 'isbn', 'language', 'citations',
        'referenceCount', 'license', 'subject', 'abstract', 'url',
    ],
    func: async (args) => {
        const doi = requireDoi(args.doi);
        const url = `${CROSSREF_BASE}/works/${encodeURIComponent(doi)}`;
        const body = await crossrefFetch(url, 'crossref work');
        const item = body?.message;
        if (!item) {
            // Crossref answers 404 → EmptyResultError already in crossrefFetch;
            // anything else with a missing message is structural breakage.
            throw new CommandExecutionError('crossref work returned no message body');
        }
        const issns = Array.isArray(item.ISSN) ? item.ISSN : [];
        const isbns = Array.isArray(item.ISBN) ? item.ISBN : [];
        const subjects = Array.isArray(item.subject) ? item.subject : [];
        const licenseEntry = Array.isArray(item.license) && item.license.length ? item.license[0] : null;
        return [{
            doi: String(item.DOI ?? doi),
            title: pickTitle(item),
            authors: formatAuthors(item.author, 50),
            container: pickContainer(item),
            publisher: String(item.publisher ?? '').trim(),
            type: String(item.type ?? '').trim(),
            published: extractPublished(item),
            pages: String(item.page ?? '').trim() || null,
            volume: String(item.volume ?? '').trim() || null,
            issue: String(item.issue ?? '').trim() || null,
            issn: issns.length ? issns.join(', ') : null,
            isbn: isbns.length ? isbns.join(', ') : null,
            language: String(item.language ?? '').trim() || null,
            citations: typeof item['is-referenced-by-count'] === 'number' ? item['is-referenced-by-count'] : null,
            referenceCount: typeof item['reference-count'] === 'number' ? item['reference-count'] : null,
            license: licenseEntry?.URL ? String(licenseEntry.URL) : null,
            subject: subjects.length ? subjects.join(', ') : null,
            abstract: stripHtml(item.abstract) || null,
            url: `https://doi.org/${item.DOI ?? doi}`,
        }];
    },
});
