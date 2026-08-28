import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { DRIBBBLE_HOST, DRIBBBLE_ORIGIN, hasDribbbleSessionCookie } from './utils.js';

async function verifyDribbbleIdentity(page) {
    if (!await hasDribbbleSessionCookie(page)) {
        throw new AuthRequiredError(DRIBBBLE_HOST, 'Dribbble session cookies are missing');
    }
    await page.goto(DRIBBBLE_ORIGIN);
    // Dribbble serves an AWS WAF challenge before the real document on fresh
    // tabs. Three seconds is not enough consistently; probing early turns a
    // valid session into a false AUTH_REQUIRED result.
    await page.wait(5);
    const result = await page.evaluate(`(() => {
        const profile = document.querySelector('a[title="Open profile"]');
        const signOut = document.querySelector('form[action$="/session"] input[name="_method"][value="delete"]');
        const href = profile?.getAttribute('href') || '';
        if (!signOut || !/^\\/[^/]+$/.test(href)) {
            return { kind: 'auth', detail: 'Dribbble header does not show a logged-in profile' };
        }
        return {
            ok: true,
            username: href.slice(1),
            profile_url: new URL(href, location.href).href,
        };
    })()`);
    if (result?.kind === 'auth') throw new AuthRequiredError(DRIBBBLE_HOST, result.detail);
    if (!result?.ok) throw new CommandExecutionError(`Unexpected Dribbble identity response: ${JSON.stringify(result)}`);
    return { username: result.username, profile_url: result.profile_url };
}

registerSiteAuthCommands({
    site: 'dribbble',
    domain: DRIBBBLE_HOST,
    loginUrl: `${DRIBBBLE_ORIGIN}/session/new`,
    columns: ['username', 'profile_url'],
    quickCheck: hasDribbbleSessionCookie,
    verify: verifyDribbbleIdentity,
    poll: async (page) => {
        if (!await hasDribbbleSessionCookie(page)) {
            throw new AuthRequiredError(DRIBBBLE_HOST, 'Waiting for Dribbble session cookies');
        }
        return verifyDribbbleIdentity(page);
    },
});
