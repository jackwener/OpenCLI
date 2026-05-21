import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    buildChatGPTReadEmptyHint,
    currentChatGPTUrl,
    ensureChatGPTLogin,
    ensureOnChatGPT,
    getVisibleMessages,
    messageHtmlToMarkdown,
    normalizeBooleanFlag,
    requirePositiveInt,
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
        { name: 'limit', type: 'int', default: 0, help: 'Max latest visible messages to return; default 0 returns all' },
        { name: 'max-chars', type: 'int', default: 0, help: 'Max characters per message; default 0 returns full text' },
        { name: 'timeout', type: 'int', default: 15, help: 'Max seconds for the read command before runtime padding' },
    ],
    columns: ['Index', 'Role', 'Text'],
    func: async (page, kwargs) => {
        const wantMarkdown = normalizeBooleanFlag(kwargs.markdown, false);
        const limit = Number(kwargs.limit ?? 0);
        if (!Number.isInteger(limit) || limit < 0) {
            throw new ArgumentError('--limit must be a non-negative integer', 'Use --limit 0 to return all visible messages.');
        }
        const maxChars = Number(kwargs['max-chars'] ?? 0);
        if (!Number.isInteger(maxChars) || maxChars < 0) {
            throw new ArgumentError('--max-chars must be a non-negative integer', 'Use --max-chars 0 to return full message text.');
        }
        requirePositiveInt(
            Number(kwargs.timeout ?? 15),
            'chatgpt read --timeout',
            'Example: opencli chatgpt read --timeout 15',
        );
        // ensureOnChatGPT now waits for the composer selector after navigating,
        // so the previous standalone 2 s settle is redundant.
        await ensureOnChatGPT(page);
        await ensureChatGPTLogin(page, 'ChatGPT read requires a logged-in ChatGPT session.');
        const messages = await getVisibleMessages(page);
        if (!messages.length) {
            const currentUrl = await currentChatGPTUrl(page);
            throw new EmptyResultError('chatgpt read', buildChatGPTReadEmptyHint(currentUrl));
        }
        const selected = limit > 0 ? messages.slice(-limit) : messages;
        return selected.map((message) => {
            const text = wantMarkdown && message.Role === 'Assistant' && message.Html
                ? (messageHtmlToMarkdown(message.Html) || message.Text)
                : message.Text;
            const clipped = maxChars > 0 && text.length > maxChars
                ? `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars; rerun with --max-chars 0 for full text]`
                : text;
            return {
                Index: message.Index,
                Role: message.Role,
                Text: clipped,
            };
        });
    },
});
