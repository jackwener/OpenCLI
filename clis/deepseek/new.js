import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { DEEPSEEK_DOMAIN, ensureFreshConversation } from './utils.js';

export const newCommand = cli({
    site: 'deepseek',
    name: 'new',
    access: 'write',
    description: 'Start a new conversation in DeepSeek',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status'],

    func: async (page) => {
        // "New chat started" must mean a confirmed fresh thread. A bare goto
        // is not enough: DeepSeek auto-restores the previous conversation
        // after the home page loads, which used to make this command report
        // success while the composer sat inside the old thread.
        const fresh = await ensureFreshConversation(page);
        if (!fresh.ok) {
            if (fresh.reason === 'composer-missing') {
                throw new CommandExecutionError(
                    'DeepSeek composer did not mount within 8 s',
                    'Verify you are logged into chat.deepseek.com.',
                );
            }
            // The reason distinguishes a restore race from a missing sidebar
            // control (i.e. a DeepSeek UI change).
            throw new CommandExecutionError(
                `DeepSeek restored the previous conversation instead of starting a new chat (${fresh.reason})`,
                'Retry, or start a new chat manually at chat.deepseek.com.',
            );
        }
        return [{ Status: 'New chat started' }];
    },
});
