import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { MANUS_DOMAIN, ensureOnManus, MANUS_API_CALL_JS, requireObject } from './_utils.js';

cli({
    site: 'manus',
    name: 'credits',
    access: 'read',
    description: 'Show Manus credit balance and refresh details.',
    domain: MANUS_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: true,
    args: [],
    columns: ['Field', 'Value'],
    func: async (page) => {
        await ensureOnManus(page);

        const c = requireObject(await page.evaluate(`(async () => {
            ${MANUS_API_CALL_JS}
            return callManusAPI('user.v1.UserService/GetAvailableCredits', {});
        })()`), 'credits');

        if (!['totalCredits', 'freeCredits', 'periodicCredits', 'refreshCredits'].some((key) => c[key] != null)) {
            throw new CommandExecutionError('Manus credits returned a malformed API payload');
        }
        return [
            { Field: 'Total Credits', Value: c.totalCredits ?? '—' },
            { Field: 'Free Credits', Value: c.freeCredits ?? '—' },
            { Field: 'Periodic Credits', Value: c.periodicCredits ?? '—' },
            { Field: 'Pro Monthly Credits', Value: c.proMonthlyCredits ?? '—' },
            { Field: 'Refresh Credits', Value: c.refreshCredits ?? '—' },
            { Field: 'Max Refresh Credits', Value: c.maxRefreshCredits ?? '—' },
            { Field: 'Next Refresh', Value: c.nextRefreshTime || '—' },
            { Field: 'Refresh Interval', Value: c.refreshInterval || '—' },
        ];
    },
});
