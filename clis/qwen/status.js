import { cli, Strategy } from '@jackwener/opencli/registry';
import { QIANWEN_DOMAIN, ensureOnQianwen, isLoggedIn, getCurrentSessionId, getModelLabel } from './utils.js';

cli({
    site: 'qwen',
    name: 'status',
    access: 'read',
    description: 'Check Qianwen page availability, login state, current session and model',
    domain: QIANWEN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Login', 'Model', 'SessionId', 'Url'],
    func: async (page) => {
        await ensureOnQianwen(page);
        await page.wait(2);
        const [loggedIn, sessionId, model, url] = await Promise.all([
            isLoggedIn(page),
            getCurrentSessionId(page),
            getModelLabel(page),
            page.evaluate('window.location.href').catch(() => ''),
        ]);
        // Model / SessionId may be unknown when the page is loading or the user
        // is in guest mode. Surface that as `null` (typed unknown) instead of a
        // string sentinel like '-' — agents can branch on null cleanly, and a
        // sentinel string would silently get treated as a real model name.
        return [{
            Status: 'Connected',
            Login: loggedIn ? 'Yes' : 'No (guest mode)',
            Model: model ? model : null,
            SessionId: sessionId ? sessionId : null,
            Url: typeof url === 'string' ? url : '',
        }];
    },
});
