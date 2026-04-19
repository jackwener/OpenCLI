import { cli, Strategy } from '@jackwener/opencli/registry';
import { DEEPSEEK_DOMAIN, getConversationList } from './utils.js';

export const historyCommand = cli({
    site: 'deepseek',
    name: 'history',
    description: 'List conversation history from DeepSeek sidebar',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max conversations to show' },
    ],
    columns: ['Index', 'Title', 'Url'],

    func: async (page, kwargs) => {
        const limit = Math.max(1, kwargs.limit || 20);
        const conversations = await getConversationList(page);
        if (conversations.length === 0) {
            return [{ Index: 0, Title: 'No conversation history found.', Url: '' }];
        }
        return conversations.slice(0, limit);
    },
});
