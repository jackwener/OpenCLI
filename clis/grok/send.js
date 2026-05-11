import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
    GROK_DOMAIN,
    authRequired,
    ensureOnGrok,
    isLoggedIn,
    normalizeBooleanFlag,
    sendMessage,
    startNewChat,
} from './utils.js';

cli({
    site: 'grok',
    name: 'send',
    access: 'write',
    description: 'Fire-and-forget: send a prompt to Grok without waiting for the reply',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'prompt', required: true, positional: true, help: 'Prompt to send to Grok' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
    ],
    columns: ['Status', 'Prompt'],
    func: async (page, kwargs) => {
        const prompt = String(kwargs.prompt || '').trim();
        if (!prompt) throw new ArgumentError('prompt', 'is required');
        const startFresh = normalizeBooleanFlag(kwargs.new, false);

        await ensureOnGrok(page);
        if (startFresh) {
            await startNewChat(page);
        }

        const send = await sendMessage(page, prompt);
        if (!send?.ok) {
            // If the composer is missing, the most likely cause is that the
            // signed-in session expired (Grok then renders a sign-in CTA in
            // place of the composer). Surface that as AuthRequiredError so
            // agents can prompt for re-auth instead of treating it as a
            // generic execution failure.
            if (!(await isLoggedIn(page))) throw authRequired();
            throw new CommandExecutionError(send?.reason || 'Failed to send Grok prompt');
        }
        return [{ Status: 'sent', Prompt: prompt }];
    },
});
