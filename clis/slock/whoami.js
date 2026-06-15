// whoami.js — registers BOTH whoami and login via the shared helper
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { SLOCK_SITE, SLOCK_DOMAIN, SLOCK_HOME_URL } from './shared.js';
import { verifySlockSession } from './auth-verify.js';

registerSiteAuthCommands({
  site: SLOCK_SITE,
  domain: SLOCK_DOMAIN,
  loginUrl: SLOCK_HOME_URL,
  verify: (page) => verifySlockSession(page),
  columns: ['id', 'name', 'email'],
});
