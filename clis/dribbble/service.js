import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    DRIBBBLE_HOST,
    DRIBBBLE_ORIGIN,
    extractServiceRows,
    normalizeLimit,
    optionalQuery,
    requireDesigner,
    requireRows,
    runBrowserTask,
} from './utils.js';

cli({
    site: 'dribbble',
    name: 'service',
    description: 'List services offered by a Dribbble designer',
    domain: DRIBBBLE_HOST,
    strategy: Strategy.UI,
    access: 'read',
    browser: true,
    args: [
        { name: 'designer', positional: true, required: true, help: 'Dribbble username or profile slug (for example: halolab)' },
        { name: 'query', type: 'string', default: '', help: 'Optional service title filter' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of services (max 30)' },
    ],
    columns: ['rank', 'id', 'title', 'priceText', 'duration', 'description', 'quickHire', 'url', 'imageUrl', 'designer'],
    func: async (page, args) => {
        const designer = requireDesigner(args.designer);
        const query = optionalQuery(args.query);
        const limit = normalizeLimit(args.limit, 20, 30);
        const url = `${DRIBBBLE_ORIGIN}/${encodeURIComponent(designer)}/services`;
        return runBrowserTask('Dribbble service extraction', async () => {
            await page.goto(url);
            await page.wait(5);
            const payload = await page.evaluate(extractServiceRows, designer);
            let rows = requireRows(payload, 'dribbble service');
            if (query) {
                const needle = query.toLowerCase();
                rows = rows.filter((row) => `${row.title} ${row.description ?? ''}`.toLowerCase().includes(needle));
                if (rows.length === 0) {
                    throw new EmptyResultError('dribbble service', `No services matching "${query}" for designer "${designer}"`);
                }
            }
            return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
        });
    },
});
