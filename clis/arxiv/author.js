// arxiv author — list papers authored by a person, newest first.
//
// arXiv's public API supports `au:` prefix queries. Author names on arXiv are
// not stable IDs, so this is a best-effort fuzzy match — the same person can
// appear under multiple spellings ("Y. Bengio" vs "Yoshua Bengio").
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { arxivFetch, normalizeArxivLimit, parseEntries } from './utils.js';

cli({
    site: 'arxiv',
    name: 'author',
    access: 'read',
    description: 'List arXiv papers by a given author (newest first)',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'author', positional: true, required: true, help: 'Author name (e.g. "Yoshua Bengio" or "Y Bengio")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max papers to return (max 50)' },
    ],
    columns: ['id', 'title', 'authors', 'published', 'primary_category', 'url'],
    func: async (args) => {
        const authorText = String(args.author || '').trim();
        if (!authorText) {
            throw new ArgumentError('arxiv author cannot be empty', 'Example: opencli arxiv author "Yoshua Bengio"');
        }
        const limit = normalizeArxivLimit(args.limit, 20, 50);
        // Quote the value so multi-word author names match as a phrase.
        const query = encodeURIComponent(`au:"${authorText}"`);
        const xml = await arxivFetch(`search_query=${query}&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`);
        const entries = parseEntries(xml);
        if (!entries.length) {
            throw new EmptyResultError('arxiv author', `No papers found for author "${authorText}". Try alternate spellings (e.g. initials).`);
        }
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
