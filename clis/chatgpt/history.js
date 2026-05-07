import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    ensureChatGPTLogin,
    ensureOnChatGPT,
    getConversationList,
    requirePositiveInt,
} from './utils.js';

export const historyCommand = cli({
    site: 'chatgpt',
    name: 'history',
    access: 'read',
    description: 'List visible ChatGPT web conversation history from the sidebar',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max conversations to show' },
    ],
    columns: ['Index', 'Id', 'Title', 'Url'],
    func: async (page, kwargs) => {
        const limit = requirePositiveInt(
            Number(kwargs.limit ?? 20),
            'chatgpt history --limit',
            'Example: opencli chatgpt history --limit 20',
        );
        await ensureOnChatGPT(page);
        await ensureChatGPTLogin(page, 'ChatGPT history requires a logged-in ChatGPT session.');
        const conversations = await getConversationList(page);
        if (!conversations.length) {
            throw new EmptyResultError('chatgpt history', 'No ChatGPT conversation links were visible in the sidebar.');
        }
        return conversations.slice(0, limit);
    },
});
