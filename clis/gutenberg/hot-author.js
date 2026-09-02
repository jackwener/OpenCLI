import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildUrl, fetchText, normalizePeriod, parseHotAuthors, requireBoundedInt } from './utils.js';

cli({
    site: 'gutenberg',
    name: 'hot-author',
    access: 'read',
    description: 'List the Project Gutenberg top author rankings',
    domain: 'www.gutenberg.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (1-100)' },
        { name: 'period', default: 'yesterday', help: 'Period: yesterday, 7days, or 30days' },
    ],
    columns: ['id', 'name', 'url'],
    func: async (args) => {
        const period = normalizePeriod(args.period);
        const limit = requireBoundedInt(args.limit, 10, 100, 'hot-author limit');
        const rows = parseHotAuthors(await fetchText(buildUrl('/browse/scores/top'), 'gutenberg hot authors'), period);
        return rows.slice(0, limit);
    },
});
