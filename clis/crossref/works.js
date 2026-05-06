// crossref works — search the Crossref scholarly metadata index.
//
// Hits `https://api.crossref.org/works?query=…&rows=…`. Returns the agent-useful
// projection: DOI (round-trips into `crossref work`), title, authors, container,
// publisher, type, published date, citation count.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    CROSSREF_BASE,
    crossrefFetch,
    extractPublished,
    formatAuthors,
    pickContainer,
    pickTitle,
    requireBoundedInt,
    requireString,
} from './utils.js';

cli({
    site: 'crossref',
    name: 'works',
    access: 'read',
    description: 'Search Crossref scholarly works (DOIs) by keyword',
    domain: 'api.crossref.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (title / author / abstract terms)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max works (1-100)' },
    ],
    columns: ['rank', 'doi', 'title', 'authors', 'container', 'publisher', 'type', 'published', 'citations', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const url = `${CROSSREF_BASE}/works?query=${encodeURIComponent(query)}&rows=${limit}`;
        const body = await crossrefFetch(url, 'crossref works');
        const list = Array.isArray(body?.message?.items) ? body.message.items : [];
        if (!list.length) {
            throw new EmptyResultError('crossref works', `No Crossref works matched "${query}".`);
        }
        return list.slice(0, limit).map((item, i) => {
            const doi = String(item.DOI ?? '').trim();
            return {
                rank: i + 1,
                doi,
                title: pickTitle(item),
                authors: formatAuthors(item.author),
                container: pickContainer(item),
                publisher: String(item.publisher ?? '').trim(),
                type: String(item.type ?? '').trim(),
                published: extractPublished(item),
                citations: typeof item['is-referenced-by-count'] === 'number' ? item['is-referenced-by-count'] : null,
                url: doi ? `https://doi.org/${doi}` : '',
            };
        });
    },
});
