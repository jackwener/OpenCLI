import { EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildUrl, fetchText, normalizeInitial, parseCategories } from './utils.js';

cli({
    site: 'gutenberg',
    name: 'categories',
    access: 'read',
    description: 'List Project Gutenberg Reading List categories, optionally filtered by initial',
    domain: 'www.gutenberg.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [{ name: 'initial', help: 'Initial letter A-Z; returns all categories by default' }],
    columns: ['id', 'initial', 'name', 'url'],
    func: async (args) => {
        const initial = normalizeInitial(args.initial);
        const rows = parseCategories(await fetchText(buildUrl('/ebooks/bookshelf/'), 'gutenberg categories'), initial);
        if (!rows.length) throw new EmptyResultError('gutenberg categories', initial ? `No categories found for ${initial}` : 'No categories found');
        return rows;
    },
});
