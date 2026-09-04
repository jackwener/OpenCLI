import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    ensureChatGPTLogin,
    ensureOnChatGPT,
    fetchChatGPTBackendJsonBatch,
    parseChatGPTConversationId,
    requireNonNegativeInt,
} from './utils.js';

function parseIdList(value) {
    const ids = String(value || '')
        .split(/[,\s]+/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => parseChatGPTConversationId(part));
    if (!ids.length) {
        throw new ArgumentError(
            'chatgpt backend-detail-batch requires at least one conversation id',
            'Example: opencli chatgpt backend-detail-batch id1,id2,id3',
        );
    }
    return Array.from(new Set(ids));
}

export const backendDetailBatchCommand = cli({
    site: 'chatgpt',
    name: 'backend-detail-batch',
    access: 'read',
    description: 'Fetch multiple raw ChatGPT conversation details from the backend API',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'ids', positional: true, required: true, help: 'Comma or whitespace separated conversation IDs or /c/<id> URLs' },
        { name: 'delay-ms', type: 'int', default: 1000, help: 'Delay between backend detail requests inside the batch' },
    ],
    columns: ['Id', 'Status', 'Body', 'Error'],
    func: async (page, kwargs) => {
        const ids = parseIdList(kwargs.ids);
        const delayMs = requireNonNegativeInt(
            Number(kwargs['delay-ms'] ?? 1000),
            'chatgpt backend-detail-batch --delay-ms',
            'Example: opencli chatgpt backend-detail-batch id1,id2 --delay-ms 1000',
        );
        await ensureOnChatGPT(page);
        await ensureChatGPTLogin(page, 'ChatGPT backend-detail-batch requires a logged-in ChatGPT session.');
        const results = await fetchChatGPTBackendJsonBatch(
            page,
            ids.map((id) => `/backend-api/conversation/${id}`),
            { label: 'chatgpt backend-detail-batch', delayMs },
        );
        return ids.map((id, index) => {
            const result = results[index] || {};
            return {
                Id: id,
                Status: result.status || '',
                Body: result.ok ? result.body : null,
                Error: result.ok ? '' : (result.body?.detail || `HTTP ${result.status || 0}`),
            };
        });
    },
});
