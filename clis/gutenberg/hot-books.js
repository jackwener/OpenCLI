import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildUrl, fetchText, normalizePeriod, parseHotBooks, requireBoundedInt } from './utils.js';

cli({
    site: 'gutenberg',
    name: 'hot-books',
    access: 'read',
    description: 'List the Project Gutenberg top book rankings',
    domain: 'www.gutenberg.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (1-100)' },
        { name: 'period', default: 'yesterday', help: 'Period: yesterday, 7days, or 30days' },
    ],
    columns: ['id', 'title', 'url'],
    func: async (args) => {
        const period = normalizePeriod(args.period);
        const limit = requireBoundedInt(args.limit, 10, 100, 'hot-books limit');
        const rows = parseHotBooks(await fetchText(buildUrl('/browse/scores/top'), 'gutenberg hot books'), period);
        return rows.slice(0, limit);
    },
});
