import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { CLAUDE_DOMAIN, ensureOnClaude, getVisibleMessages, ensureClaudeLogin } from './utils.js';

export const readCommand = cli({
    site: 'claude',
    name: 'read',
    access: 'read',
    description: 'Read the current Claude conversation',
    domain: CLAUDE_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [],
    columns: ['Index', 'Role', 'Text'],

    func: async (page) => {
        // ensureOnClaude now waits for the composer selector; the previous post-nav
        // 3 s settle is covered by that event-based wait.
        await ensureOnClaude(page);
        await ensureClaudeLogin(page, 'Claude read requires a logged-in Claude session.');
        const messages = await getVisibleMessages(page);
        if (messages.length > 0) return messages;
        throw new EmptyResultError('claude read', 'No visible Claude messages were found in the current conversation.');
    },
});
