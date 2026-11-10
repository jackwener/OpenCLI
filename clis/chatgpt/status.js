import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CHATGPT_DOMAIN,
    ensureOnChatGPT,
    describeChatGPTModelPicker,
    getChatGPTModelPicker,
    getPageState,
} from './utils.js';

export const statusCommand = cli({
    site: 'chatgpt',
    name: 'status',
    access: 'read',
    description: 'Check ChatGPT web page availability, login state, and whether the account can switch models',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Login', 'Models', 'Url'],
    func: async (page) => {
        await ensureOnChatGPT(page);
        const state = await getPageState(page);
        const loggedIn = state.isLoggedIn && !state.hasLoginGate;
        // "no model picker" means `chatgpt model` cannot set a model here.
        const planText = loggedIn ? describeChatGPTModelPicker(await getChatGPTModelPicker(page)) : 'unknown (not logged in)';
        return [{
            Status: state.hasComposer ? 'Connected' : 'Page not ready',
            Login: loggedIn ? 'Yes' : 'No',
            Models: planText,
            Url: state.url,
        }];
    },
});
