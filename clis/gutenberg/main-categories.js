import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildUrl, fetchText, parseMainCategories } from './utils.js';

cli({
    site: 'gutenberg',
    name: 'main-categories',
    access: 'read',
    description: 'List Project Gutenberg main book categories and parent categories',
    domain: 'www.gutenberg.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['id', 'name', 'parentName', 'url'],
    func: async () => {
        return parseMainCategories(await fetchText(buildUrl('/ebooks/categories'), 'gutenberg main categories'));
    },
});
