import { cli, Strategy } from '@jackwener/opencli/registry';
import { CLAUDE_DOMAIN, CLAUDE_URL, COMPOSER_SELECTOR, ensureClaudeComposer } from './utils.js';

export const newCommand = cli({
    site: 'claude',
    name: 'new',
    access: 'read',
    description: 'Start a new conversation in Claude',
    domain: CLAUDE_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [],
    columns: ['Status'],

    func: async (page) => {
        await page.goto(CLAUDE_URL);
        // Wait for the composer to mount instead of a fixed 2 s sleep. If it
        // never mounts, swallow and let ensureClaudeComposer surface a typed error.
        try {
            await page.wait({ selector: COMPOSER_SELECTOR, timeout: 8 });
        } catch {
            // Login or error page — ensureClaudeComposer below throws AuthRequiredError / CommandExecutionError.
        }
        await ensureClaudeComposer(page, 'Claude new requires a logged-in Claude session with a visible composer.');
        return [{ Status: 'New chat started' }];
    },
});
