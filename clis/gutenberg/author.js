import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchAllAuthorBooks, requireChoice, requireId } from './utils.js';

const SORTS = ['title', 'downloads', 'release_date'];

cli({
    site: 'gutenberg',
    name: 'author',
    access: 'read',
    description: 'List all books by a Project Gutenberg author',
    domain: 'www.gutenberg.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Author number, for example 69' },
        { name: 'sort', default: 'downloads', choices: SORTS, help: 'Sort by title, downloads, or release_date' },
    ],
    columns: ['id', 'title', 'author', 'url', 'downloads'],
    func: async (args) => {
        const id = requireId(args.id, 'author id');
        const sort = requireChoice(args.sort, 'downloads', SORTS, 'author sort');
        const rows = await fetchAllAuthorBooks(id, sort);
        return rows.map((row) => ({ id: row.id, title: row.title, author: row.author, url: row.url, downloads: row.downloads }));
    },
});
