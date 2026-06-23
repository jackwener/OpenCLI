import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { listConversations } from './_actions.js';

cli({
    site: 'antigravity',
    name: 'history',
    access: 'read',
    description: 'List visible Antigravity conversations from the sidebar',
    domain: '127.0.0.1',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'limit', type: 'int', required: false, default: 50, help: 'Max conversations to return' },
    ],
    columns: ['Index', 'Id', 'Title'],
    func: async (page, kwargs) => {
        const all = await listConversations(page);
        const limit = Number.isInteger(kwargs.limit) && kwargs.limit > 0 ? kwargs.limit : 50;
        const sliced = all.slice(0, limit);
        if (!sliced.length) {
            throw new EmptyResultError('antigravity history', 'No conversations are visible in the sidebar. Open the sidebar and retry.');
        }
        return sliced.map((c) => ({ Index: c.index, Id: c.id, Title: c.title }));
    },
});
