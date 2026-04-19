import { cli, Strategy } from '@jackwener/opencli/registry';
import { DEEPSEEK_DOMAIN, ensureOnDeepSeek, getPageState } from './utils.js';

export const statusCommand = cli({
    site: 'deepseek',
    name: 'status',
    description: 'Check DeepSeek page availability and login state',
    domain: DEEPSEEK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Login', 'Url'],

    func: async (page) => {
        await ensureOnDeepSeek(page);
        const state = await getPageState(page);
        return [{
            Status: state.hasTextarea ? 'Connected' : 'Page not ready',
            Login: state.isLoggedIn ? 'Yes' : 'No',
            Url: state.url,
        }];
    },
});
