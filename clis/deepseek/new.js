import { cli, Strategy } from '@jackwener/opencli/registry';
import { DEEPSEEK_DOMAIN, DEEPSEEK_URL } from './utils.js';

export const newCommand = cli({
    site: 'deepseek',
    name: 'new',
    access: 'read',
    description: 'Start a new conversation in DeepSeek',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['Status'],

    func: async (page) => {
        await page.goto(DEEPSEEK_URL);
        await page.wait(2);
        return [{ Status: 'New chat started' }];
    },
});
