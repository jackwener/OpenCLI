// nodeseek login / whoami — NodeSeek session auth.
//
// Auth state is the `pjwt` cookie; the logged-in identity is injected as
// `window.__config__.user`.
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { NS_HOME, hasNsSessionCookie, readCurrentUser } from './client.js';

async function verifyNsIdentity(page) {
    if (!await hasNsSessionCookie(page))
        throw new AuthRequiredError('nodeseek', 'NodeSeek pjwt cookie missing — anonymous');
    const user = await readCurrentUser(page);
    if (!user || !user.member_id)
        throw new AuthRequiredError('nodeseek', 'NodeSeek window.__config__.user missing — anonymous');
    return {
        member_id: String(user.member_id),
        member_name: String(user.member_name || ''),
        rank: user.rank ?? null,
    };
}

registerSiteAuthCommands({
    site: 'nodeseek',
    domain: 'nodeseek.com',
    loginUrl: `${NS_HOME}/login`,
    columns: ['member_id', 'member_name', 'rank'],
    quickCheck: hasNsSessionCookie,
    verify: verifyNsIdentity,
    poll: async (page) => {
        if (!await hasNsSessionCookie(page))
            throw new AuthRequiredError('nodeseek', 'Waiting for NodeSeek login (pjwt cookie)');
        return verifyNsIdentity(page);
    },
});
