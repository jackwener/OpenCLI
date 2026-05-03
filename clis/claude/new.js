import { cli, Strategy } from '@jackwener/opencli/registry';
import { CLAUDE_DOMAIN, CLAUDE_URL, ensureClaudeComposer } from './utils.js';

export const newCommand = cli({
    site: 'claude',
    name: 'new',
    description: 'Start a new conversation in Claude',
    domain: CLAUDE_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['Status'],

    func: async (page) => {
        await page.goto(CLAUDE_URL);
        await page.wait(2);
        await ensureClaudeComposer(page, 'Claude new requires a logged-in Claude session with a visible composer.');
        return [{ Status: 'New chat started' }];
    },
});
