import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    YUANBAO_DOMAIN,
    YUANBAO_URL,
    ensureYuanbaoPage,
    getYuanbaoSessionList,
    hasLoginGate,
    authRequired,
} from './shared.js';

cli({
    site: 'yuanbao',
    name: 'history',
    access: 'read',
    description: 'List recent Yuanbao conversations from the sidebar (requires login)',
    domain: YUANBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max conversations to list (sidebar virtual scroll caps actual count)' },
    ],
    columns: ['Index', 'Title', 'AgentId', 'SessionId', 'Url'],
    func: async (page, kwargs) => {
        const limit = Number(kwargs.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('limit', 'must be a positive integer');
        }
        await ensureYuanbaoPage(page);
        if (await hasLoginGate(page)) {
            throw authRequired('Yuanbao opened a login gate when reading the sidebar.');
        }
        await page.wait(1.5);
        const sessions = await getYuanbaoSessionList(page, limit);
        if (!sessions.length) {
            throw new EmptyResultError(
                'yuanbao history',
                'No Yuanbao conversations found in the sidebar. Either the account is logged out, the sidebar is collapsed, or the user truly has no chat history yet.',
            );
        }
        return sessions.map((s, i) => ({
            Index: i + 1,
            Title: s.title || '(untitled)',
            AgentId: s.agentId,
            SessionId: s.cid,
            Url: `${YUANBAO_URL}chat/${s.agentId}/${s.cid}`,
        }));
    },
});
