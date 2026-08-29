import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DRIBBBLE_HOST,
    DRIBBBLE_ORIGIN,
    extractShotDetailRow,
    requireRow,
    requireShotTarget,
    runBrowserTask,
} from './utils.js';

cli({
    site: 'dribbble',
    name: 'shot-detail',
    description: 'Show details and media for a Dribbble shot',
    domain: DRIBBBLE_HOST,
    strategy: Strategy.UI,
    access: 'read',
    browser: true,
    args: [
        { name: 'shot', positional: true, required: true, help: 'Numeric shot id or dribbble.com/shots URL' },
    ],
    columns: [
        'id', 'title', 'designer', 'designerUrl', 'team', 'description',
        'imageUrl', 'mediaUrls', 'colors', 'availableForWork', 'url',
    ],
    func: async (page, args) => {
        const shotId = requireShotTarget(args.shot);
        return runBrowserTask('Dribbble shot detail extraction', async () => {
            await page.goto(`${DRIBBBLE_ORIGIN}/shots/${shotId}`);
            await page.wait(5);
            const payload = await page.evaluate(extractShotDetailRow, shotId);
            return [requireRow(payload, 'dribbble shot-detail')];
        });
    },
});
