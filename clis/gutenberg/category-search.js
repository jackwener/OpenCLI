import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildUrl, fetchCategorySearchPages, requireChoice, requireString } from './utils.js';

const SORTS = ['title', 'downloads', 'quantity', 'release_date'];

cli({
    site: 'gutenberg',
    name: 'category-search',
    access: 'read',
    description: 'Search Project Gutenberg bookshelf categories',
    domain: 'www.gutenberg.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Category search query' },
        { name: 'sort', default: 'downloads', choices: SORTS, help: 'Sort by title, downloads, quantity, or release_date' },
    ],
    columns: ['name', 'downloads', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'category search query');
        const sort = requireChoice(args.sort, 'downloads', SORTS, 'category search sort');
        const rows = await fetchCategorySearchPages(query, sort);
        return rows.map(({ name, downloads, url }) => ({ name, downloads, url }));
    },
});
