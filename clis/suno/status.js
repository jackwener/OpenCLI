/**
 * `opencli suno status` — quick health check: login state, plan, credit
 * breakdown, captcha readiness. Lets agents pre-flight before spending
 * generate credits.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
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
            if (err instanceof AuthRequiredError) {
                return [{
                    Status: 'Not logged in',
                    Plan: '-',
                    Credits: '-',
                    Monthly: '-',
                    Captcha: '-',
                }];
            }
            throw err;
        }
        let captcha;
        try {
            captcha = await checkSunoCaptcha(page, session.deviceId);
        } catch (err) {
            // Conservative: assume captcha is required when the pre-flight
            // probe fails, so the displayed status doesn't claim "Not required"
            // for an unverified state.
            captcha = { required: true };
        }
        const b = session.breakdown;
        // ensureSunoSession surfaces planKey derived from billing/info's
        // subscription_type vs plans[] lookup; planId may be null for accounts
        // whose plan cannot be resolved against plans[] (e.g., new schema fields).
        return [{
            Status: 'Connected',
            Plan: session.planKey,
            Credits: String(session.totalCreditsAvailable),
            Monthly: `${b.monthlyRemaining}/${b.monthlyLimit}`,
            Captcha: captcha?.required === true ? 'Required (solve in UI)' : 'Not required',
        }];
    },
});
