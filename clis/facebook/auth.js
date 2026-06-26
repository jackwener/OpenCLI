import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasFacebookCUserCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.facebook.com' });
  return cookies.some(c => c.name === 'c_user' && c.value);
}

async function verifyFacebookIdentity(page) {
  if (!await hasFacebookCUserCookie(page)) {
    throw new AuthRequiredError('www.facebook.com', 'Facebook c_user cookie missing — anonymous session');
  }
  const cookies = await page.getCookies({ url: 'https://www.facebook.com' });
  const cUser = cookies.find(c => c.name === 'c_user')?.value || '';
  await page.goto('https://www.facebook.com/me');
  await page.wait(2);
  const finalUrl = await page.evaluate(`location.href`);
  const vanityMatch = String(finalUrl || '').match(/facebook\.com\/([^/?#]+)\/?(?:$|[?#])/);
  const vanity = vanityMatch?.[1] || '';
  if (!vanity || vanity === 'login.php' || vanity === 'checkpoint') {
    throw new AuthRequiredError('www.facebook.com', `Facebook /me redirected to ${finalUrl} — logged out or in checkpoint`);
  }
  return {
    user_id: String(cUser),
    vanity: String(vanity),
    profile_url: `https://www.facebook.com/${vanity}/`,
  };
}

registerSiteAuthCommands({
  site: 'facebook',
  domain: 'facebook.com',
  loginUrl: 'https://www.facebook.com/login.php',
  columns: ['user_id', 'vanity', 'profile_url'],
  quickCheck: hasFacebookCUserCookie,
  verify: verifyFacebookIdentity,
  poll: async (page) => {
    if (!await hasFacebookCUserCookie(page)) {
      throw new AuthRequiredError('www.facebook.com', 'Waiting for Facebook c_user cookie');
    }
    return verifyFacebookIdentity(page);
  },
});
