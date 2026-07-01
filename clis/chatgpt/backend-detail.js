import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CHATGPT_DOMAIN,
    ensureChatGPTLogin,
    ensureOnChatGPT,
    fetchChatGPTBackendJson,
    parseChatGPTConversationId,
} from './utils.js';

export const backendDetailCommand = cli({
    site: 'chatgpt',
    name: 'backend-detail',
    access: 'read',
    description: 'Fetch raw ChatGPT conversation detail from the backend API',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Conversation ID or full /c/<id> URL' },
    ],
    columns: ['Id', 'Status', 'Body'],
    func: async (page, kwargs) => {
        const id = parseChatGPTConversationId(kwargs.id);
        await ensureOnChatGPT(page);
        await ensureChatGPTLogin(page, 'ChatGPT backend-detail requires a logged-in ChatGPT session.');
        const result = await fetchChatGPTBackendJson(page, `/backend-api/conversation/${id}`, 'chatgpt backend-detail');
        return [{
            Id: id,
            Status: result.status,
            Body: result.body,
        }];
    },
});
