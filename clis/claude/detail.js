import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { CLAUDE_DOMAIN, getVisibleMessages, ensureClaudeLogin, requireConversationId } from './utils.js';

export const detailCommand = cli({
    site: 'claude',
    name: 'detail',
    access: 'read',
    description: 'Open a Claude conversation by ID and read its messages',
    domain: CLAUDE_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Conversation ID (UUID from /chat/<id>)' },
    ],
    columns: ['Index', 'Role', 'Text'],

    func: async (page, kwargs) => {
        const id = requireConversationId(kwargs.id);

        await page.goto(`https://claude.ai/chat/${id}`);
        await page.wait(4);
        await ensureClaudeLogin(page, 'Claude detail requires a logged-in Claude session.');

        const messages = await getVisibleMessages(page);
        if (messages.length > 0) return messages;
        throw new EmptyResultError('claude detail', `No visible Claude messages were found for conversation ${id}.`);
    },
});
