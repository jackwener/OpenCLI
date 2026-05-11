import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    CONVERSATION_MESSAGE_SELECTOR,
    ensureChatGPTLogin,
    getVisibleMessages,
    messageHtmlToMarkdown,
    normalizeBooleanFlag,
    parseChatGPTConversationId,
} from './utils.js';

export const detailCommand = cli({
    site: 'chatgpt',
    name: 'detail',
    access: 'read',
    description: 'Open a ChatGPT web conversation by ID and read its messages',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Conversation ID or full /c/<id> URL' },
        { name: 'markdown', type: 'boolean', default: false, help: 'Emit assistant replies as markdown' },
    ],
    columns: ['Index', 'Role', 'Text'],
    func: async (page, kwargs) => {
        const id = parseChatGPTConversationId(kwargs.id);
        const wantMarkdown = normalizeBooleanFlag(kwargs.markdown, false);
        await page.goto(`${CHATGPT_URL}/c/${id}`, { settleMs: 2000 });
        try {
            await page.wait({ selector: CONVERSATION_MESSAGE_SELECTOR, timeout: 10 });
        } catch {
            // Empty conversation, missing access, or login redirect — handled by ensureChatGPTLogin / EmptyResultError below.
        }
        await ensureChatGPTLogin(page, 'ChatGPT detail requires a logged-in ChatGPT session.');
        const messages = await getVisibleMessages(page);
        if (!messages.length) {
            throw new EmptyResultError('chatgpt detail', `No visible ChatGPT messages were found for conversation ${id}.`);
        }
        return messages.map((message) => ({
            Index: message.Index,
            Role: message.Role,
            Text: wantMarkdown && message.Role === 'Assistant' && message.Html
                ? (messageHtmlToMarkdown(message.Html) || message.Text)
                : message.Text,
        }));
    },
});
