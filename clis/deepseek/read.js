import { cli, Strategy } from '@jackwener/opencli/registry';
import { DEEPSEEK_DOMAIN, ensureOnDeepSeek, getVisibleMessages } from './utils.js';

export const readCommand = cli({
    site: 'deepseek',
    name: 'read',
    access: 'read',
    description: 'Read the current DeepSeek conversation',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [],
    columns: ['Role', 'Text'],

    func: async (page) => {
        await ensureOnDeepSeek(page);
        await page.wait(5);
        const messages = await getVisibleMessages(page);
        if (messages.length > 0) return messages;
        return [{ Role: 'system', Text: 'No visible messages found.' }];
    },
});
