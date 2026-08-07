import { cli, Strategy } from '@jackwener/opencli/registry';
import { midjourneyIdentity, midjourneyQuickCheck } from './auth-utils.js';
import { MIDJOURNEY_DOMAIN, MIDJOURNEY_IMAGINE_URL } from './utils.js';

cli({
  site: 'midjourney',
  name: 'whoami',
  access: 'read',
  description: 'Verify the current Midjourney login and show non-identifying subscription state',
  example: 'opencli midjourney whoami -f json',
  domain: MIDJOURNEY_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: MIDJOURNEY_IMAGINE_URL,
  args: [],
  columns: ['logged_in', 'site', 'plan', 'subscription_status'],
  authStatus: { quickCheck: midjourneyQuickCheck },
  func: midjourneyIdentity,
});
