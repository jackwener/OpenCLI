import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOUBAO_DOMAIN, getDoubaoConversationList } from './utils.js';
export const historyCommand = cli({
    site: 'doubao',
    name: 'history',
    description: 'List conversation history from Doubao sidebar',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'limit', required: false, help: 'Max number of conversations to show', default: '50' },
    ],
    columns: ['Index', 'Id', 'Title', 'Url'],
    func: async (page, kwargs) => {
        const limit = parseInt(kwargs.limit, 10) || 50;
        const conversations = await getDoubaoConversationList(page);
        if (conversations.length === 0) {
            return [{ Index: 0, Id: '', Title: 'No conversation history found. Make sure you are logged in.', Url: '' }];
        }
        return conversations.slice(0, limit).map((conv, i) => ({
            Index: i + 1,
            Id: conv.Id,
            Title: conv.Title,
            Url: conv.Url,
        }));
    },
});
