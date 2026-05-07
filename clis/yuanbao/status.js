import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    YUANBAO_DOMAIN,
    ensureYuanbaoPage,
    isLoggedIn,
    getCurrentYuanbaoSessionId,
    getYuanbaoModelLabel,
} from './shared.js';

cli({
    site: 'yuanbao',
    name: 'status',
    access: 'read',
    description: 'Check Yuanbao page availability, login state, current session and model',
    domain: YUANBAO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    browserSession: { reuse: 'site' },
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Login', 'Model', 'ModelId', 'AgentId', 'SessionId', 'Url'],
    func: async (page) => {
        await ensureYuanbaoPage(page);
        await page.wait(1.5);
        const [loggedIn, session, model, url] = await Promise.all([
            isLoggedIn(page),
            getCurrentYuanbaoSessionId(page),
            getYuanbaoModelLabel(page),
            page.evaluate('window.location.href').catch(() => ''),
        ]);
        // Surface unknown values as `null` (typed unknown) rather than '-' / ''
        // sentinels — sentinels look like real labels and silently break filters
        // built on these columns.
        return [{
            Status: 'Connected',
            Login: loggedIn ? 'Yes' : 'No (login gate)',
            Model: model.label,
            ModelId: model.modelId,
            AgentId: session?.agentId ?? null,
            SessionId: session?.convId ?? null,
            Url: typeof url === 'string' ? url : '',
        }];
    },
});
