// nodeseek login / whoami — NodeSeek session auth.
//
// Auth state is the `pjwt` cookie; the logged-in identity is injected as
// `window.__config__.user`.
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { NS_HOME, getNsSessionCookie, hasNsSessionCookie, readCurrentUser } from './client.js';

async function verifyNsIdentity(page, { skipNavigate = false } = {}) {
    if (!await hasNsSessionCookie(page))
        throw new AuthRequiredError('nodeseek.com', 'NodeSeek pjwt cookie missing — anonymous');
    const user = await readCurrentUser(page, { skipNavigate });
    if (!user || !user.member_id)
        throw new AuthRequiredError('nodeseek.com', 'NodeSeek window.__config__.user missing — anonymous');
    return {
        member_id: String(user.member_id),
        member_name: String(user.member_name || ''),
        rank: user.rank ?? null,
    };
}

// pjwt value that already failed a navigating verify. The login poll runs on
// the visible login tab; without this gate a stale/expired cookie would make
// every poll navigate the user off the login form (login page has no
// `window.__config__`, so a passive probe alone can't confirm identity).
let lastFailedPjwt = null;

registerSiteAuthCommands({
    site: 'nodeseek',
    domain: 'nodeseek.com',
    loginUrl: `${NS_HOME}/login`,
    columns: ['member_id', 'member_name', 'rank'],
    quickCheck: hasNsSessionCookie,
    verify: verifyNsIdentity,
    poll: async (page) => {
        const pjwt = await getNsSessionCookie(page);
        if (!pjwt)
            throw new AuthRequiredError('nodeseek.com', 'Waiting for NodeSeek login (pjwt cookie)');
        // Passive probe first — succeeds when login redirected to a real page.
        try {
            return await verifyNsIdentity(page, { skipNavigate: true });
        } catch { /* fall through to the navigating verify */ }
        if (pjwt === lastFailedPjwt)
            throw new AuthRequiredError('nodeseek.com', 'Waiting for NodeSeek login (cookie present but session not established)');
        try {
            return await verifyNsIdentity(page); // cookie changed — verify once (navigates)
        } catch (err) {
            lastFailedPjwt = pjwt;
            throw err;
        }
    },
});
