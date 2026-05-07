import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    DEEPSEEK_DOMAIN,
    ensureOnDeepSeek,
    getVisibleMessages,
    parseDeepSeekConversationId,
} from './utils.js';

export const detailCommand = cli({
    site: 'deepseek',
    name: 'detail',
    access: 'read',
    description: 'Read a specific DeepSeek conversation by ID',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'Conversation ID (UUID) or full /a/chat/s/<id> URL' },
    ],
    columns: ['Role', 'Text'],
    func: async (page, kwargs) => {
        const id = parseDeepSeekConversationId(kwargs.id);
        await ensureOnDeepSeek(page);
        await page.goto(`https://chat.deepseek.com/a/chat/s/${id}`);
        await page.wait(5);
        const messages = await getVisibleMessages(page);
        if (messages.length === 0) {
            throw new EmptyResultError(
                'deepseek detail',
                `No visible messages found for conversation ${id}. Verify the ID is correct and that you are logged in.`,
            );
        }
        return messages;
    },
});
