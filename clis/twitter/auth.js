import { AuthRequiredError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { normalizeTwitterScreenName, unwrapBrowserResult } from './shared.js';

async function hasTwitterSessionCookies(page) {
  const cookies = await page.getCookies({ url: 'https://x.com' });
  const names = new Set(cookies.map(cookie => cookie.name));
  return names.has('auth_token') && names.has('ct0');
}

async function verifyTwitterIdentity(page) {
  if (!await hasTwitterSessionCookies(page)) {
    throw new AuthRequiredError('x.com', 'Twitter/X auth cookies are missing');
  }
  await page.goto('https://x.com/home');
  await page.wait(1);
  const href = unwrapBrowserResult(await page.evaluate(`() => {
    const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    return link ? link.getAttribute('href') : null;
  }`));
  const username = normalizeTwitterScreenName(typeof href === 'string' ? href : '');
  if (!username) {
    throw new AuthRequiredError('x.com', 'Could not detect the logged-in Twitter/X profile link');
  }
  return { username, url: `https://x.com/${username}` };
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
