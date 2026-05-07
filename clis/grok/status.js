import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    GROK_DOMAIN,
    ensureOnGrok,
    getCurrentSessionId,
    getModelLabel,
    isLoggedIn,
} from './utils.js';

cli({
    site: 'grok',
    name: 'status',
    access: 'read',
    description: 'Check Grok page availability, login state, current session and model',
    domain: GROK_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Login', 'Model', 'SessionId', 'Url'],
    func: async (page) => {
        await ensureOnGrok(page);
        await page.wait(2);
        const [loggedIn, sessionId, model, url] = await Promise.all([
            isLoggedIn(page),
            getCurrentSessionId(page),
            getModelLabel(page),
            page.evaluate('window.location.href').catch(() => ''),
        ]);
        // Surface unknowns as `null` rather than a sentinel string so agents
        // can branch cleanly.
        return [{
            Status: 'Connected',
            Login: loggedIn ? 'Yes' : 'No',
            Model: model ? model : null,
            SessionId: sessionId ? sessionId : null,
            Url: typeof url === 'string' ? url : '',
        }];
    },
});
