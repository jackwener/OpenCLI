import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { CLAUDE_DOMAIN, getConversationList, ensureClaudeLogin, requirePositiveInt } from './utils.js';

export const historyCommand = cli({
    site: 'claude',
    name: 'history',
    description: 'List conversation history from Claude /recents',
    domain: CLAUDE_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max conversations to show' },
    ],
    columns: ['Index', 'Id', 'Title', 'Url'],

    func: async (page, kwargs) => {
        const limit = requirePositiveInt(
            Number(kwargs.limit ?? 20),
            'claude history --limit',
            'Example: opencli claude history --limit 20',
        );
        const conversations = await getConversationList(page);
        await ensureClaudeLogin(page, 'Claude history requires a logged-in Claude session.');
        if (conversations.length === 0) {
            throw new EmptyResultError('claude history', 'No Claude conversation history was visible on /recents.');
        }
        return conversations.slice(0, limit);
    },
});
