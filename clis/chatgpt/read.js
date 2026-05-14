import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    CONVERSATION_TURN_SELECTOR,
    ensureChatGPTLogin,
    ensureOnChatGPT,
    getConversationList,
    getVisibleMessages,
    messageHtmlToMarkdown,
    normalizeBooleanFlag,
    revealChatGPTConversation,
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
        let messages = await getVisibleMessages(page);
        if (!messages.length) {
            await revealChatGPTConversation(page);
            messages = await getVisibleMessages(page);
        }
        if (!messages.length) {
            const currentUrl = await page.evaluate('window.location.href').catch(() => '');
            if (!String(currentUrl).includes('/c/')) {
                const conversations = await getConversationList(page);
                for (const conversation of conversations.slice(0, 5)) {
                    if (!conversation?.Id) continue;
                    await page.goto(`${CHATGPT_URL}/c/${conversation.Id}`, { settleMs: 2000 });
                    try {
                        await page.wait({ selector: CONVERSATION_TURN_SELECTOR, timeout: 10 });
                    } catch {
                        // Empty conversation, access issue, or DOM drift — getVisibleMessages may still use snapshot fallback.
                    }
                    messages = await getVisibleMessages(page);
                    if (!messages.length) {
                        await revealChatGPTConversation(page);
                        messages = await getVisibleMessages(page);
                    }
                    if (messages.length) break;
                }
            }
        }
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
