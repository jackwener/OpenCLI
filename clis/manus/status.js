import { cli, Strategy } from '@jackwener/opencli/registry';
import { MANUS_DOMAIN, ensureOnManus, MANUS_API_CALL_JS } from './_utils.js';

cli({
    site: 'manus',
    name: 'status',
    access: 'read',
    description: 'Show current Manus user profile and credit summary.',
    domain: MANUS_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: true,
    args: [],
    columns: ['Field', 'Value'],
    func: async (page) => {
        await ensureOnManus(page);

        const [userInfo, credits] = await page.evaluate(`(async () => {
            ${MANUS_API_CALL_JS}
            const [u, c] = await Promise.all([
                callManusAPI('user.v1.UserService/UserInfo', {}),
                callManusAPI('user.v1.UserService/GetAvailableCredits', {}),
            ]);
            return [u, c];
        })()`);

        const u = userInfo || {};
        const c = credits || {};
        return [
            { Field: 'Email', Value: u.email || '—' },
            { Field: 'Display Name', Value: u.displayname || u.displayName || '—' },
            { Field: 'User ID', Value: u.userId || u.uid || '—' },
            { Field: 'Membership Tier', Value: u.membershipTier || '—' },
            { Field: 'Total Credits', Value: c.totalCredits ?? '—' },
            { Field: 'Periodic Credits', Value: c.periodicCredits ?? '—' },
            { Field: 'Refresh Credits', Value: c.refreshCredits ?? '—' },
            { Field: 'Next Refresh', Value: c.nextRefreshTime || '—' },
        ];
    },
});