import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    ensureChatGPTLogin,
    ensureOnChatGPT,
    fetchChatGPTBackendConversationItems,
    requirePositiveInt,
} from './utils.js';

export const backendHistoryCommand = cli({
    site: 'chatgpt',
    name: 'backend-history',
    access: 'read',
    description: 'List ChatGPT conversations from the backend API instead of the visible sidebar',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 200, help: 'Max backend conversations to return' },
        { name: 'page-size', type: 'int', default: 100, help: 'Backend page size per request' },
    ],
    columns: ['Index', 'Id', 'Title', 'Url', 'CreateTime', 'UpdateTime', 'Raw'],
    func: async (page, kwargs) => {
        const limit = requirePositiveInt(
            Number(kwargs.limit ?? 200),
            'chatgpt backend-history --limit',
            'Example: opencli chatgpt backend-history --limit 500',
        );
        const pageSize = requirePositiveInt(
            Number(kwargs['page-size'] ?? 100),
            'chatgpt backend-history --page-size',
            'Example: opencli chatgpt backend-history --page-size 100',
        );
        if (pageSize > 100) {
            throw new ArgumentError('page-size', 'must be ≤ 100 for the ChatGPT backend conversations API');
        }

        await ensureOnChatGPT(page);
        await ensureChatGPTLogin(page, 'ChatGPT backend-history requires a logged-in ChatGPT session.');

        const items = await fetchChatGPTBackendConversationItems(page, {
            limit,
            pageSize,
            label: 'chatgpt backend-history',
        });
        const rows = items.map((item, index) => ({
            Index: index + 1,
            Id: String(item.id || item.conversation_id || '').trim(),
            Title: String(item.title || '(untitled)').trim() || '(untitled)',
            Url: `${CHATGPT_URL}/c/${String(item.id || item.conversation_id || '').trim()}`,
            CreateTime: item.create_time || '',
            UpdateTime: item.update_time || '',
            Raw: item,
        }));

        if (!rows.length) {
            throw new EmptyResultError('chatgpt backend-history', 'No ChatGPT backend conversations were returned.');
        }
        return rows;
    },
});
