import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { fetchBookPages, fetchBookPagesForIds, requireBoundedInt, requireChoice } from './utils.js';

const SORTS = ['title', 'downloads', 'release_date'];

cli({
    site: 'gutenberg',
    name: 'search',
    access: 'read',
    description: 'Search Project Gutenberg books, returning 10 results by default',
    domain: 'www.gutenberg.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'title', positional: true, default: '', help: 'Optional book title or keyword' },
        { name: 'sort', default: 'downloads', choices: SORTS, help: 'Sort by title, downloads, or release_date' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (1-100)' },
    ],
    columns: ['id', 'title', 'author', 'url', 'downloads'],
    func: async (args) => {
        const sort = requireChoice(args.sort, 'downloads', SORTS, 'search sort');
        const limit = requireBoundedInt(args.limit, 10, 100, 'search limit');
        const rows = await fetchBookPages('/ebooks/search/', { query: String(args.title ?? '').trim(), sort_order: sort }, limit, 'gutenberg search');
        if (sort !== 'downloads') {
            const query = String(args.title ?? '').trim();
            const downloadRows = await fetchBookPagesForIds('/ebooks/search/', { query, sort_order: 'downloads' }, new Set(rows.map((row) => row.id)), 'gutenberg search downloads');
            const downloadsById = new Map(downloadRows.map((row) => [row.id, row.downloads]));
            return rows.map((row) => {
                const downloads = downloadsById.get(row.id);
                if (downloads === undefined || downloads === null) {
                    throw new CommandExecutionError(`gutenberg search did not provide a download count for ebook ${row.id}`);
                }
                return { id: row.id, title: row.title, author: row.author, url: row.url, downloads };
            });
        }
        if (rows.some((row) => row.downloads === null)) {
            throw new CommandExecutionError('gutenberg search download counts were missing from the downloads-sorted results');
        }
        return rows.map((row) => ({ id: row.id, title: row.title, author: row.author, url: row.url, downloads: row.downloads }));
    },
});
