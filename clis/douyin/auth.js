import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { browserFetch } from './_shared/browser-fetch.js';

async function hasDouyinSessionCookies(page) {
  const cookies = await page.getCookies({ url: 'https://creator.douyin.com' });
  const names = new Set(cookies.map(cookie => cookie.name));
  return names.has('sessionid') || names.has('uid_tt') || names.has('passport_csrf_token');
}

async function verifyDouyinIdentity(page) {
  await page.goto('https://creator.douyin.com');
  const url = 'https://creator.douyin.com/web/api/media/user/info/?aid=1128';
  const payload = await browserFetch(page, 'GET', url);
  const user = payload.user_info ?? payload.user;
  if (!user) {
    throw new CommandExecutionError('Douyin user info response is missing user_info');
  }
  return {
    id: user.uid ?? '',
    username: user.nickname ?? '',
    followers: user.follower_count ?? 0,
  };
}

registerSiteAuthCommands({
  site: 'douyin',
  domain: 'creator.douyin.com',
  loginUrl: 'https://creator.douyin.com/',
  columns: ['id', 'username', 'followers'],
  quickCheck: hasDouyinSessionCookies,
  verify: verifyDouyinIdentity,
  poll: async (page) => {
    if (!await hasDouyinSessionCookies(page)) {
      throw new AuthRequiredError('creator.douyin.com', 'Waiting for Douyin creator session cookies');
    }
    return verifyDouyinIdentity(page);
  },
});
