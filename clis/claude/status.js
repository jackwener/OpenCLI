import { cli, Strategy } from '@jackwener/opencli/registry';
import { CLAUDE_DOMAIN, ensureOnClaude, getPageState } from './utils.js';

export const statusCommand = cli({
    site: 'claude',
    name: 'status',
    access: 'read',
    description: 'Check Claude page availability and login state',
    domain: CLAUDE_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Login', 'Url'],

    func: async (page) => {
        await ensureOnClaude(page);
        const state = await getPageState(page);
        return [{
            Status: state.hasComposer ? 'Connected' : 'Page not ready',
            Login: state.isLoggedIn ? 'Yes' : 'No',
            Url: state.url,
        }];
    },
});
