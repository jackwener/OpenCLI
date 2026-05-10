import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { arxivFetch, normalizeArxivLimit, parseEntries } from './utils.js';
cli({
    site: 'arxiv',
    name: 'search',
    access: 'read',
    description: 'Search arXiv papers',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "attention is all you need")' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results (max 25)' },
    ],
    columns: ['id', 'title', 'authors', 'published', 'primary_category', 'url'],
    func: async (args) => {
        const queryText = String(args.query || '').trim();
        if (!queryText) {
            throw new ArgumentError('arxiv search query cannot be empty');
        }
        const limit = normalizeArxivLimit(args.limit, 10, 25);
        const query = encodeURIComponent(`all:${queryText}`);
        const xml = await arxivFetch(`search_query=${query}&max_results=${limit}&sortBy=relevance`);
        const entries = parseEntries(xml);
        if (!entries.length)
            throw new EmptyResultError('arxiv', 'No papers found. Try a different keyword.');
        return entries.map(e => ({
            id: e.id,
            title: e.title,
            authors: e.authors,
            published: e.published,
            primary_category: e.primary_category,
            url: e.url,
        }));
    },
});
