import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    CHATGPT_URL,
    CONVERSATION_MESSAGE_SELECTOR,
    ensureChatGPTLogin,
    getChatGPTDetailRows,
    normalizeBooleanFlag,
    parseChatGPTConversationId,
    requireNonNegativeInt,
    requirePositiveInt,
    waitForChatGPTDetailRows,
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
        { name: 'wait', type: 'boolean', default: false, help: 'Wait until the conversation stops generating and stabilizes' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait when --wait is true' },
        { name: 'stable', type: 'int', default: 6, help: 'Seconds the final messages must remain unchanged when --wait is true' },
    ],
    columns: ['Index', 'Role', 'Text', 'Generating', 'StableSeconds'],
    func: async (page, kwargs) => {
        const id = parseChatGPTConversationId(kwargs.id);
        const wantMarkdown = normalizeBooleanFlag(kwargs.markdown, false);
        const shouldWait = normalizeBooleanFlag(kwargs.wait, false);
        const timeout = requirePositiveInt(
            Number(kwargs.timeout ?? 120),
            'chatgpt detail --timeout',
            'Example: opencli chatgpt detail <id> --wait true --timeout 600',
        );
        const stableSeconds = requireNonNegativeInt(
            Number(kwargs.stable ?? 6),
            'chatgpt detail --stable',
            'Example: opencli chatgpt detail <id> --wait true --stable 6',
        );
        await page.goto(`${CHATGPT_URL}/c/${id}`, { settleMs: 2000 });
        try {
            await page.wait({ selector: CONVERSATION_MESSAGE_SELECTOR, timeout: 10 });
        } catch {
            // Empty conversation, missing access, or login redirect — handled by ensureChatGPTLogin / EmptyResultError below.
        }
        await ensureChatGPTLogin(page, 'ChatGPT detail requires a logged-in ChatGPT session.');
        const { messages, rows } = shouldWait
            ? await waitForChatGPTDetailRows(page, { wantMarkdown, timeoutSeconds: timeout, stableSeconds })
            : await getChatGPTDetailRows(page, { wantMarkdown });
        if (!messages.length) {
            throw new EmptyResultError('chatgpt detail', `No visible ChatGPT messages were found for conversation ${id}.`);
        }
        return rows;
    },
});
