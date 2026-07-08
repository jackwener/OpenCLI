// openalex search — search OpenAlex's Works index by free text.
//
// Hits `https://api.openalex.org/works?search=…&per-page=…`. Returns the
// agent-useful projection: OpenAlex Work id (round-trips into `openalex
// work`), DOI, title, year, citation count, first author, primary venue,
// open-access status.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    OPENALEX_BASE,
    appendMailto,
    bareDoi,
    bareId,
    openalexFetch,
    requireBoundedInt,
    requireString,
} from './utils.js';

const SELECT_FIELDS = [
    'id', 'doi', 'title', 'publication_year', 'publication_date',
    'cited_by_count', 'authorships', 'primary_location', 'open_access', 'type',
].join(',');

cli({
    site: 'openalex',
    name: 'search',
    access: 'read',
    description: 'Search OpenAlex Works (papers, books, preprints) by keyword',
    domain: 'api.openalex.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search text (e.g. "transformers", "open access scholarly")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max works (1-200, single OpenAlex page)' },
    ],
    columns: ['rank', 'id', 'title', 'year', 'citations', 'firstAuthor', 'venue', 'openAccess', 'type', 'doi', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 200);
        const url = appendMailto(
            `${OPENALEX_BASE}/works?search=${encodeURIComponent(query)}&per-page=${limit}&select=${SELECT_FIELDS}`,
        );
        const body = await openalexFetch(url, 'openalex search');
        const list = Array.isArray(body?.results) ? body.results : [];
        if (!list.length) {
            throw new EmptyResultError('openalex search', `No OpenAlex works matched "${query}".`);
        }
        return list.slice(0, limit).map((w, i) => {
            const firstAuthor = Array.isArray(w.authorships) && w.authorships.length
                ? String(w.authorships[0]?.author?.display_name ?? '').trim()
                : '';
            const venue = String(w.primary_location?.source?.display_name ?? '').trim();
            const id = bareId(w.id);
            return {
                rank: i + 1,
                id,
                title: String(w.title ?? '').trim(),
                year: w.publication_year != null ? Number(w.publication_year) : null,
                citations: w.cited_by_count != null ? Number(w.cited_by_count) : null,
                firstAuthor,
                venue,
                openAccess: Boolean(w.open_access?.is_oa),
                type: String(w.type ?? '').trim(),
                doi: bareDoi(w.doi),
                url: id ? `https://openalex.org/${id}` : '',
            };
        });
    },
});
