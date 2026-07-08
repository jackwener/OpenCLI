import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { CLAUDE_DOMAIN, MESSAGE_SELECTOR, getVisibleMessages, ensureClaudeLogin, requireConversationId } from './utils.js';

export const detailCommand = cli({
    site: 'claude',
    name: 'detail',
    access: 'read',
    description: 'Open a Claude conversation by ID and read its messages',
    domain: CLAUDE_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Conversation ID (UUID from /chat/<id>)' },
    ],
    columns: ['Index', 'Role', 'Text'],

    func: async (page, kwargs) => {
        const id = requireConversationId(kwargs.id);

        await page.goto(`https://claude.ai/chat/${id}`);
        // Wait for the first assistant message bubble to render instead of a
        // fixed 4 s sleep. Swallow the timeout so empty conversations and
        // login redirects fall through to ensureClaudeLogin / EmptyResultError.
        try {
            await page.wait({ selector: MESSAGE_SELECTOR, timeout: 10 });
        } catch {
            // Empty conversation, missing access, or login redirect — handled below.
        }
        await ensureClaudeLogin(page, 'Claude detail requires a logged-in Claude session.');

        const messages = await getVisibleMessages(page);
        if (messages.length > 0) return messages;
        throw new EmptyResultError('claude detail', `No visible Claude messages were found for conversation ${id}.`);
    },
});
