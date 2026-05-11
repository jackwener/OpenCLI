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
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Role', 'Text'],

    func: async (page) => {
        // ensureOnDeepSeek already waits for the composer to mount; the
        // follow-up 5 s sleep was redundant.
        await ensureOnDeepSeek(page);
        const messages = await getVisibleMessages(page);
        if (messages.length > 0) return messages;
        return [{ Role: 'system', Text: 'No visible messages found.' }];
    },
});
