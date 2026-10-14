import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { DOUBAO_DOMAIN, getDoubaoConversationList } from './utils.js';
const MAX_HISTORY_LIMIT = 5000;
export const historyCommand = cli({
    site: 'doubao',
    name: 'history',
    access: 'read',
    description: 'List conversation history from Doubao sidebar',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'limit', required: false, help: 'Max number of conversations to show', default: '50' },
    ],
    columns: ['Index', 'Id', 'Title', 'Url'],
    func: async (page, kwargs) => {
        const rawLimit = kwargs.limit ?? '50';
        const limit = Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
            throw new ArgumentError(`Doubao history limit must be an integer between 1 and ${MAX_HISTORY_LIMIT}: ${rawLimit}`);
        }
        const conversations = await getDoubaoConversationList(page, { limit });
        if (conversations.length === 0) {
            throw new EmptyResultError('doubao history', 'No conversations were extracted. Verify the Doubao login state and retry.');
        }
        return conversations.slice(0, limit).map((conv, i) => ({
            Index: i + 1,
            Id: conv.Id,
            Title: conv.Title,
            Url: conv.Url,
        }));
    },
});
