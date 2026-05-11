import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { DEEPSEEK_DOMAIN, DEEPSEEK_URL, TEXTAREA_SELECTOR } from './utils.js';

export const newCommand = cli({
    site: 'deepseek',
    name: 'new',
    access: 'read',
    description: 'Start a new conversation in DeepSeek',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status'],

    func: async (page) => {
        await page.goto(DEEPSEEK_URL);
        // Confirm the composer mounted before reporting success. The previous
        // 2 s blind sleep would return "New chat started" even when the page
        // was still loading or the user was logged out.
        try {
            await page.wait({ selector: TEXTAREA_SELECTOR, timeout: 8 });
        } catch {
            throw new CommandExecutionError(
                'DeepSeek composer did not mount within 8 s',
                'Verify you are logged into chat.deepseek.com.',
            );
        }
        return [{ Status: 'New chat started' }];
    },
});
