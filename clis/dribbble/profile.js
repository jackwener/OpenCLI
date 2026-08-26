import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    DRIBBBLE_HOST,
    DRIBBBLE_ORIGIN,
    extractProfileRow,
    requireDesigner,
} from './utils.js';

cli({
    site: 'dribbble',
    name: 'profile',
    description: 'Show a public Dribbble designer profile',
    domain: DRIBBBLE_HOST,
    strategy: Strategy.PUBLIC,
    access: 'read',
    browser: true,
    args: [
        { name: 'designer', positional: true, required: true, help: 'Dribbble username or profile slug (for example: halolab)' },
    ],
    columns: ['username', 'name', 'intro', 'followersCount', 'followingCount', 'likesCount', 'availableForWork', 'website', 'url', 'avatarUrl'],
    func: async (page, args) => {
        const designer = requireDesigner(args.designer);
        try {
            await page.goto(`${DRIBBBLE_ORIGIN}/${encodeURIComponent(designer)}`);
            await page.wait(2);
            const payload = await page.evaluate(extractProfileRow, designer);
            if (!payload?.ok || !payload.row) {
                throw new CommandExecutionError(`Dribbble profile selector drift: ${payload?.reason ?? 'profile payload was unreadable'}`);
            }
            return [payload.row];
        } catch (error) {
            if (error?.code === 'COMMAND_EXEC' || error?.code === 'ARGUMENT' || error?.code === 'EMPTY_RESULT') throw error;
            throw new CommandExecutionError(`Dribbble profile extraction failed: ${error?.message ?? error}`);
        }
    },
});
