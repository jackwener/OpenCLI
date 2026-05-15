import { cli, Strategy } from '@jackwener/opencli/registry';
import { QIANWEN_DOMAIN, QIANWEN_URL, startNewChat, dismissLoginModal } from './utils.js';

cli({
    site: 'qwen',
    name: 'new',
    access: 'write',
    description: 'Start a new conversation in Qianwen',
    domain: QIANWEN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        await page.goto(QIANWEN_URL);
        await page.wait(2);
        await dismissLoginModal(page);
        await startNewChat(page);
        return [{ Status: 'New chat started' }];
    },
});
