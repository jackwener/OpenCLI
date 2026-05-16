/**
 * Upwork personalized feed (Best Matches / Most Recent).
 *
 * Reads the logged-in user's recommended-jobs feed. Two tabs are
 * supported: `best-matches` (default, Upwork's relevance-ranked feed)
 * and `most-recent` (chronological). Both surface the full job list in
 * `window.__NUXT__.state.feed{BestMatch,MostRecent}.{jobs, paging}`.
 *
 * Login is required — bare visitors get redirected through the
 * onboarding flow and never see the feed state.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
    EmptyResultError,
    AuthRequiredError,
} from '@jackwener/opencli/errors';
import {
    LIST_COLUMNS,
    buildFeedUrl,
    feedStateKey,
    jobToListRow,
    requireBoundedInt,
    requireFeedTab,
} from './utils.js';

cli({
    site: 'upwork',
    name: 'feed',
    aliases: ['best-matches'],
    access: 'read',
    description: 'Upwork personalized jobs feed (best-matches | most-recent) — requires login',
    domain: 'www.upwork.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'tab', positional: true, required: false, default: 'best-matches', help: 'Feed tab: best-matches | most-recent' },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (1-50, capped at one page)' },
    ],
    columns: LIST_COLUMNS,
    func: async (page, kwargs) => {
        const tab = requireFeedTab(kwargs.tab);
        const limit = requireBoundedInt(kwargs.limit, 20, 1, 50, 'limit');
        const stateKey = feedStateKey(tab);
        const url = buildFeedUrl(tab);

        await page.goto(url);
        await page.wait(5);

        let payload;
        try {
            payload = await page.evaluate(`(async () => {
                const key = ${JSON.stringify(stateKey)};
                const haveState = () => !!(window.__NUXT__ && window.__NUXT__.state && window.__NUXT__.state[key]);
                let ready = haveState();
                for (let i = 0; i < 30; i++) {
                    if (ready) break;
                    await new Promise(r => setTimeout(r, 500));
                    ready = haveState();
                }
                const onLogin = /\\/(ab\\/account-security\\/login|nx\\/login)/.test(location.pathname);
                const challenge = (document.title || '').toLowerCase().includes('just a moment') || !!document.querySelector('[id^="cf-"]');
                const state = window.__NUXT__ && window.__NUXT__.state && window.__NUXT__.state[key];
                return {
                    ready,
                    onLogin,
                    challenge,
                    jobs: state && Array.isArray(state.jobs) ? state.jobs : [],
                    paging: state && state.paging ? state.paging : null,
                };
            })()`);
        }
        catch (e) {
            throw new CommandExecutionError(`Failed to read Upwork feed state: ${e?.message ?? e}`, 'The Nuxt state global was not reachable; try again after opening Upwork in the connected browser.');
        }

        if (payload?.onLogin) {
            throw new AuthRequiredError('upwork.com', 'Upwork redirected to login. Open https://www.upwork.com in the connected browser and sign in, then retry.');
        }
        if (payload?.challenge) {
            throw new CommandExecutionError('Upwork served a Cloudflare challenge page', 'Open https://www.upwork.com in the connected browser and clear the challenge, then retry.');
        }
        if (!payload?.ready) {
            throw new CommandExecutionError(`Upwork feed state (window.__NUXT__.state.${stateKey}) was not present within 15s`, 'The page may not have finished hydrating, or the SSR state shape may have changed.');
        }

        const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
        if (jobs.length === 0) {
            throw new EmptyResultError(`upwork feed ${tab}`, `Upwork ${tab} feed is empty for the current account`);
        }

        return jobs.slice(0, limit).map((j, i) => jobToListRow(j, i + 1));
    },
});
