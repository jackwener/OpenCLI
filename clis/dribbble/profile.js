import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DRIBBBLE_HOST,
    DRIBBBLE_ORIGIN,
    extractProfileRow,
    requireRow,
    requireDesigner,
    runBrowserTask,
} from './utils.js';

cli({
    site: 'dribbble',
    name: 'profile',
    description: 'Show a public Dribbble designer profile',
    domain: DRIBBBLE_HOST,
    strategy: Strategy.UI,
    access: 'read',
    browser: true,
    args: [
        { name: 'designer', positional: true, required: true, help: 'Dribbble username or profile slug (for example: halolab)' },
    ],
    columns: [
        'username', 'name', 'intro', 'biography', 'followersCount', 'followingCount', 'likesCount',
        'availableForWork', 'location', 'memberSince', 'skills', 'languages', 'socialLinks',
        'website', 'url', 'avatarUrl',
    ],
    func: async (page, args) => {
        const designer = requireDesigner(args.designer);
        return runBrowserTask('Dribbble profile extraction', async () => {
            await page.goto(`${DRIBBBLE_ORIGIN}/${encodeURIComponent(designer)}/about`);
            await page.wait(5);
            const payload = await page.evaluate(extractProfileRow, designer);
            return [requireRow(payload, 'dribbble profile')];
        });
    },
});
