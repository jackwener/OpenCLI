import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CHATGPT_DOMAIN,
    ensureOnChatGPT,
    getPageState,
} from './utils.js';

export const statusCommand = cli({
    site: 'chatgpt',
    name: 'status',
    access: 'read',
    description: 'Check ChatGPT web page availability and login state',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Login', 'Url'],
    func: async (page) => {
        await ensureOnChatGPT(page);
        const state = await getPageState(page);
        return [{
            Status: state.hasComposer ? 'Connected' : 'Page not ready',
            Login: state.isLoggedIn && !state.hasLoginGate ? 'Yes' : 'No',
            Url: state.url,
        }];
    },
});
