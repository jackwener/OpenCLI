import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { CLAUDE_DOMAIN, CLAUDE_URL, COMPOSER_SELECTOR, ensureOnClaude, sendMessage, parseBoolFlag, withRetry, ensureClaudeComposer, requireNonEmptyPrompt } from './utils.js';

export const sendCommand = cli({
    site: 'claude',
    name: 'send',
    access: 'write',
    description: 'Send a prompt to Claude without waiting for the response',
    domain: CLAUDE_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
    ],
    columns: ['Status', 'SubmittedBy', 'InjectedText'],

    func: async (page, kwargs) => {
        const prompt = requireNonEmptyPrompt(kwargs.prompt, 'claude send');

        if (parseBoolFlag(kwargs.new)) {
            await page.goto(CLAUDE_URL);
            try {
                await page.wait({ selector: COMPOSER_SELECTOR, timeout: 8 });
            } catch {
                // Composer didn't mount; ensureClaudeComposer below surfaces a typed error.
            }
        } else {
            // ensureOnClaude now waits for the composer selector; the previous
            // post-nav 2 s settle is covered by that event-based wait.
            await ensureOnClaude(page);
        }
        await withRetry(() => ensureClaudeComposer(page, 'Claude send requires a visible composer on the current page.'));

        const sendResult = await withRetry(() => sendMessage(page, prompt));
        if (!sendResult?.ok) {
            throw new CommandExecutionError(sendResult?.reason || 'Failed to send message');
        }
        return [{
            Status: 'Success',
            SubmittedBy: sendResult.method || 'send-button',
            InjectedText: prompt,
        }];
    },
});
