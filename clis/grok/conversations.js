import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { listConversations, normalizeConversationRow, normalizeLimit } from './history-api.js';
import { GROK_DOMAIN, ensureOnGrok } from './utils.js';

cli({
    site: 'grok',
    name: 'conversations',
    access: 'read',
    description: 'List every Grok chat in the account through grok.com\'s own API',
    example: 'opencli grok conversations -f json',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'limit', type: 'int', default: 0, help: 'Max conversations, in the order grok.com lists them; 0 lists all' },
    ],
    columns: ['index', 'id', 'title', 'createdAt', 'updatedAt', 'starred', 'temporary', 'url'],
    func: async (page, kwargs) => {
        const limit = normalizeLimit(kwargs.limit);
        await ensureOnGrok(page);
        const conversations = await listConversations(page);
        if (!conversations.length) {
            throw new EmptyResultError('grok conversations', 'The signed-in account has no Grok chats.');
        }
        const rows = conversations.map(normalizeConversationRow);
        return limit ? rows.slice(0, limit) : rows;
    },
});
