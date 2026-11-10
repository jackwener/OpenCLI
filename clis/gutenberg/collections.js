import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildUrl, fetchText, parseCollections } from './utils.js';

cli({
    site: 'gutenberg',
    name: 'collections',
    access: 'read',
    description: 'List the top Collections from Project Gutenberg Reading Lists',
    domain: 'www.gutenberg.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['name', 'url'],
    func: async () => {
        const rows = parseCollections(await fetchText(buildUrl('/ebooks/bookshelf/'), 'gutenberg collections'));
        return rows.map(({ name, url }) => ({ name, url }));
    },
});
