import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    ensureChatGPTLogin,
    ensureOnChatGPT,
    getVisibleMessages,
    messageHtmlToMarkdown,
    normalizeBooleanFlag,
} from './utils.js';

export const readCommand = cli({
    site: 'chatgpt',
    name: 'read',
    access: 'read',
    description: 'Read messages in the current ChatGPT web conversation',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'markdown', type: 'boolean', default: false, help: 'Emit assistant replies as markdown' },
    ],
    columns: ['Index', 'Role', 'Text'],
    func: async (page, kwargs) => {
        const wantMarkdown = normalizeBooleanFlag(kwargs.markdown, false);
        // ensureOnChatGPT now waits for the composer selector after navigating,
        // so the previous standalone 2 s settle is redundant.
        await ensureOnChatGPT(page);
        await ensureChatGPTLogin(page, 'ChatGPT read requires a logged-in ChatGPT session.');
        const messages = await getVisibleMessages(page);
        if (!messages.length) {
            throw new EmptyResultError('chatgpt read', 'No visible ChatGPT messages were found in the current conversation.');
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
