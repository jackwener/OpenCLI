import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DRIBBBLE_HOST,
    DRIBBBLE_ORIGIN,
    extractDesignerRows,
    normalizeLimit,
    optionalQuery,
    requireRows,
    runBrowserTask,
} from './utils.js';

cli({
    site: 'dribbble',
    name: 'designer',
    description: 'Browse Dribbble designers and freelance agencies',
    domain: DRIBBBLE_HOST,
    strategy: Strategy.UI,
    access: 'read',
    browser: true,
    args: [
        { name: 'query', type: 'string', default: '', help: 'Optional designer or skill keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of designers (max 30)' },
    ],
    columns: [
        'rank', 'id', 'username', 'name', 'rating', 'projectCount',
        'budgetText', 'location', 'responseTime', 'serviceCount', 'skills', 'url', 'avatarUrl',
    ],
    func: async (page, args) => {
        const query = optionalQuery(args.query);
        const limit = normalizeLimit(args.limit, 20, 30);
        const url = new URL(`${DRIBBBLE_ORIGIN}/hire`);
        if (query) url.searchParams.set('keywords', query);
        return runBrowserTask('Dribbble designer extraction', async () => {
            await page.goto(url.href);
            await page.wait(5);
            const payload = await page.evaluate(extractDesignerRows, limit);
            return requireRows(payload, 'dribbble designer');
        });
    },
});
