import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOUBAO_DOMAIN, getDoubaoPageState } from './utils.js';
export const statusCommand = cli({
    site: 'doubao',
    name: 'status',
    access: 'read',
    description: 'Check Doubao chat page availability and login state',
    domain: DOUBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Login', 'Url', 'Title'],
    func: async (page) => {
        const state = await getDoubaoPageState(page);
        const loggedIn = state.isLogin === null ? 'Unknown' : state.isLogin ? 'Yes' : 'No';
        const status = state.isLogin === false ? 'Login Required' : 'Connected';
        return [{
                Status: status,
                Login: loggedIn,
                Url: state.url,
                Title: state.title || 'Doubao',
            }];
    },
});
