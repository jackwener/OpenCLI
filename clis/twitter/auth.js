import { AuthRequiredError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { resolveLoggedInTwitterUser } from './shared.js';

async function hasTwitterSessionCookies(page) {
  const cookies = await page.getCookies({ url: 'https://x.com' });
  const names = new Set(cookies.map(cookie => cookie.name));
  return names.has('auth_token') && names.has('ct0');
}

/**
 * Identity comes from the `twid` session cookie plus a UserByRestId lookup
 * (see resolveLoggedInTwitterUser) rather than the sidebar profile link: the
 * link lagged behind account switches (#2252) and is not rendered by every
 * X web client variant (#2770).
 */
async function verifyTwitterIdentity(page) {
  if (!await hasTwitterSessionCookies(page)) {
    throw new AuthRequiredError('x.com', 'Twitter/X auth cookies are missing');
  }
  // The viewer lookup is a same-origin fetch, so the tab must sit on x.com.
  await page.goto('https://x.com/home');
  const { screenName } = await resolveLoggedInTwitterUser(page);
  return { username: screenName, url: `https://x.com/${screenName}` };
}

registerSiteAuthCommands({
  site: 'twitter',
  domain: 'x.com',
  loginUrl: 'https://x.com/i/flow/login',
  columns: ['username', 'url'],
  quickCheck: hasTwitterSessionCookies,
  verify: verifyTwitterIdentity,
  poll: async (page) => {
    if (!await hasTwitterSessionCookies(page)) {
      throw new AuthRequiredError('x.com', 'Waiting for Twitter/X auth cookies');
    }
    return verifyTwitterIdentity(page);
  },
});
