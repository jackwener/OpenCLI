import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DRIBBBLE_HOST,
    DRIBBBLE_ORIGIN,
    extractMemberRows,
    normalizeLimit,
    requireDesigner,
    requireRows,
    runBrowserTask,
} from './utils.js';

cli({
    site: 'dribbble',
    name: 'member',
    description: 'List public members of a Dribbble team profile',
    domain: DRIBBBLE_HOST,
    strategy: Strategy.UI,
    access: 'read',
    browser: true,
    args: [
        { name: 'designer', positional: true, required: true, help: 'Dribbble team username or profile slug' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of members (max 30)' },
    ],
    columns: ['rank', 'username', 'name', 'location', 'url', 'avatarUrl', 'recentShotUrls'],
    func: async (page, args) => {
        const designer = requireDesigner(args.designer);
        const limit = normalizeLimit(args.limit, 20, 30);
        return runBrowserTask('Dribbble member extraction', async () => {
            await page.goto(`${DRIBBBLE_ORIGIN}/${encodeURIComponent(designer)}/members`);
            await page.wait(5);
            const payload = await page.evaluate(extractMemberRows, designer, limit);
            return requireRows(payload, 'dribbble member');
        });
    },
});
