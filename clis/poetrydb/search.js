// poetrydb search — search PoetryDB by author or title (or both).
//
// Endpoints:
//   GET /author/<author-text>            poems by author
//   GET /title/<title-text>              poems by title
//   GET /author,title/<author>;<title>   intersection
//
// At least one of --author / --title must be supplied. Returns one row
// per poem with full text in the `text` column (newline-joined).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    POETRYDB_BASE,
    isPoetryDbNotFound,
    poetrydbFetch,
    projectPoem,
    requireBoundedInt,
} from './utils.js';

cli({
    site: 'poetrydb',
    name: 'search',
    access: 'read',
    description: 'Search PoetryDB by --author and/or --title',
    domain: 'poetrydb.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'author', help: 'Author name (substring match)' },
        { name: 'title', help: 'Title text (substring match)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max poems (1-200, default 20)' },
    ],
    columns: ['rank', 'title', 'author', 'lineCount', 'firstLine', 'lastLine', 'text', 'url'],
    func: async (args) => {
        const author = String(args.author ?? '').trim();
        const title = String(args.title ?? '').trim();
        if (!author && !title) {
            throw new ArgumentError('poetrydb search requires --author or --title');
        }
        const limit = requireBoundedInt(args.limit, 20, 200);
        let url;
        if (author && title) {
            url = `${POETRYDB_BASE}/author,title/${encodeURIComponent(author)};${encodeURIComponent(title)}`;
        } else if (author) {
            url = `${POETRYDB_BASE}/author/${encodeURIComponent(author)}`;
        } else {
            url = `${POETRYDB_BASE}/title/${encodeURIComponent(title)}`;
        }
        const body = await poetrydbFetch(url, 'poetrydb search');
        if (isPoetryDbNotFound(body)) {
            throw new EmptyResultError('poetrydb search', 'PoetryDB returned no poems for these filters.');
        }
        const list = Array.isArray(body) ? body : [];
        if (!list.length) {
            throw new EmptyResultError('poetrydb search', 'PoetryDB returned an empty result.');
        }
        return list.slice(0, limit).map((p, i) => ({
            rank: i + 1,
            ...projectPoem(p),
        }));
    },
});
