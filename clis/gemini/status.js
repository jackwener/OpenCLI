import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    GEMINI_DOMAIN,
    ensureGeminiPage,
    getGeminiPageState,
} from './utils.js';

export const statusCommand = cli({
    site: 'gemini',
    name: 'status',
    access: 'read',
    description: 'Check Gemini web page availability and login state',
    domain: GEMINI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Login', 'Url'],
    func: async (page) => {
        await ensureGeminiPage(page);
        const state = await getGeminiPageState(page);
        // `isSignedIn` is one of {true, false, null}. `null` means the composer
        // was visible but no explicit Sign-in CTA was found — treat as logged in.
        const loggedIn = state.isSignedIn === false ? 'No' : 'Yes';
        return [{
            Status: state.canSend ? 'Connected' : 'Page not ready',
            Login: loggedIn,
            Url: state.url || '',
        }];
    },
});
