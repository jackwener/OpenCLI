import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    GROK_DOMAIN,
    authRequired,
    ensureOnGrok,
    getHistoryFromSidebar,
    isLoggedIn,
} from './utils.js';

cli({
    site: 'grok',
    name: 'history',
    access: 'read',
    description: 'List recent Grok conversations from the sidebar (requires login)',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max conversations to show (default 20, max 100)' },
    ],
    columns: ['Index', 'Title', 'Url'],
    func: async (page, kwargs) => {
        const limit = Number(kwargs.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('limit', 'must be a positive integer');
        }
        if (limit > 100) {
            throw new ArgumentError('limit', 'must be <= 100');
        }
        await ensureOnGrok(page);
        await page.wait(2);
        if (!(await isLoggedIn(page))) {
            throw authRequired();
        }
        const sessions = await getHistoryFromSidebar(page, limit);
        if (!sessions.length) {
            throw new EmptyResultError('grok history', 'No Grok conversations found in the sidebar for the signed-in account.');
        }
        return sessions.slice(0, limit).map((s, i) => ({
            Index: i + 1,
            Title: s.title || '(untitled)',
            Url: `https://grok.com/c/${s.id}`,
        }));
    },
});
