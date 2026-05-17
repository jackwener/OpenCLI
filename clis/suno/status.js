/**
 * `opencli suno status` — quick health check: login state, plan, credit
 * breakdown, captcha readiness. Lets agents pre-flight before spending
 * generate credits.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    SUNO_DOMAIN,
    checkSunoCaptcha,
    ensureSunoSession,
} from './utils.js';

export const statusCommand = cli({
    site: 'suno',
    name: 'status',
    access: 'read',
    description: 'Check Suno login, plan, credit balance, and captcha readiness',
    domain: SUNO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [],
    columns: ['Status', 'Plan', 'Credits', 'Monthly', 'Captcha'],
    func: async (page) => {
        let session;
        try {
            session = await ensureSunoSession(page);
        } catch (err) {
            return [{
                Status: 'Not logged in',
                Plan: '-',
                Credits: '-',
                Monthly: '-',
                Captcha: '-',
            }];
        }
        let captcha;
        try {
            captcha = await checkSunoCaptcha(page, session.deviceId);
        } catch (err) {
            captcha = { required: null, error: String(err).slice(0, 80) };
        }
        const b = session.breakdown;
        return [{
            Status: 'Connected',
            Plan: session.planKey || 'unknown',
            Credits: String(session.totalCreditsAvailable),
            Monthly: `${b.monthlyRemaining}/${b.monthlyLimit}`,
            Captcha: captcha?.required === true ? 'Required (solve in UI)' : captcha?.required === false ? 'Not required' : 'Unknown',
        }];
    },
});
