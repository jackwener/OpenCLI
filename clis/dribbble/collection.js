import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DRIBBBLE_HOST,
    DRIBBBLE_ORIGIN,
    extractCollectionRows,
    normalizeLimit,
    requireDesigner,
    requireRows,
    runBrowserTask,
} from './utils.js';

cli({
    site: 'dribbble',
    name: 'collection',
    description: 'List public collections curated by a Dribbble designer',
    domain: DRIBBBLE_HOST,
    strategy: Strategy.UI,
    access: 'read',
    browser: true,
    args: [
        { name: 'designer', positional: true, required: true, help: 'Dribbble username or profile slug' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of collections (max 30)' },
    ],
    columns: ['rank', 'id', 'title', 'shotCount', 'designerCount', 'url'],
    func: async (page, args) => {
        const designer = requireDesigner(args.designer);
        const limit = normalizeLimit(args.limit, 20, 30);
        return runBrowserTask('Dribbble collection extraction', async () => {
            await page.goto(`${DRIBBBLE_ORIGIN}/${encodeURIComponent(designer)}/collections`);
            await page.wait(5);
            const payload = await page.evaluate(extractCollectionRows, designer, limit);
            return requireRows(payload, 'dribbble collection');
        });
    },
});
