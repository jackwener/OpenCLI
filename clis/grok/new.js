import { cli, Strategy } from '@jackwener/opencli/registry';
import { GROK_DOMAIN, startNewChat } from './utils.js';

cli({
    site: 'grok',
    name: 'new',
    access: 'write',
    description: 'Start a new conversation in Grok',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [],
    columns: ['Status'],
    func: async (page) => {
        await startNewChat(page);
        return [{ Status: 'New chat started' }];
    },
});
