import { AuthRequiredError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { midjourneyIdentity } from './auth-utils.js';
import { MIDJOURNEY_DOMAIN, MIDJOURNEY_IMAGINE_URL, normalizePositiveInt } from './utils.js';

cli({
  site: 'midjourney',
  name: 'login',
  access: 'write',
  description: 'Open Midjourney in a foreground Chrome window and wait for login to complete',
  example: 'opencli midjourney login --timeout 300',
  domain: MIDJOURNEY_DOMAIN,
  strategy: Strategy.UI,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  args: [{ name: 'timeout', type: 'int', default: 300, help: 'Maximum seconds to wait for interactive login (1..900)' }],
  columns: ['status', 'logged_in', 'site', 'plan', 'subscription_status'],
  func: async (page, kwargs) => {
    const timeout = normalizePositiveInt(kwargs.timeout, 300, 900, '--timeout');
    await page.goto(MIDJOURNEY_IMAGINE_URL);
    try {
      return { status: 'already_logged_in', ...await midjourneyIdentity(page) };
    } catch (error) {
      if (!(error instanceof AuthRequiredError)) throw error;
    }
    const deadline = Date.now() + timeout * 1000;
    while (Date.now() < deadline) {
      await page.wait(2);
      try {
        return { status: 'login_complete', ...await midjourneyIdentity(page) };
      } catch (error) {
        if (!(error instanceof AuthRequiredError)) throw error;
      }
    }
    throw new TimeoutError(
      'Midjourney login', timeout,
      'Finish signing in in the foreground Chrome window, then retry `opencli midjourney whoami`.',
    );
  },
});
