import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    GEMINI_DOMAIN,
    ensureGeminiPage,
    getGeminiVisibleTurns,
} from './utils.js';

export const readCommand = cli({
    site: 'gemini',
    name: 'read',
    access: 'read',
    description: 'Read the turns visible in the current Gemini web conversation',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Index', 'Role', 'Text'],
    func: async (page) => {
        await ensureGeminiPage(page);
        const turns = await getGeminiVisibleTurns(page);
        if (!Array.isArray(turns) || turns.length === 0) {
            throw new EmptyResultError(
                'gemini read',
                'No turns were visible. Open a Gemini conversation first or use `opencli gemini detail <id>` to navigate.',
            );
        }
        return turns.map((t, idx) => ({
            Index: idx + 1,
            Role: t.Role || 'System',
            Text: t.Text || '',
        }));
    },
});
