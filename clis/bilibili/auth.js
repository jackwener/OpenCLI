import { AuthRequiredError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { apiGet, getSelfUid } from './utils.js';

async function hasBilibiliSessionCookies(page) {
  const cookies = await page.getCookies({ url: 'https://www.bilibili.com' });
  const names = new Set(cookies.map(cookie => cookie.name));
  return names.has('SESSDATA') && names.has('DedeUserID');
}

async function verifyBilibiliIdentity(page) {
  await page.goto('https://www.bilibili.com');
  const uid = await getSelfUid(page);
  const payload = await apiGet(page, '/x/space/wbi/acc/info', { params: { mid: uid }, signed: true });
  const data = payload?.data ?? {};
  return {
    id: String(data.mid ?? uid),
    username: data.name ?? '',
    level: data.level ?? 0,
  };
}

registerSiteAuthCommands({
  site: 'bilibili',
  domain: 'www.bilibili.com',
  loginUrl: 'https://passport.bilibili.com/login',
  columns: ['id', 'username', 'level'],
  quickCheck: hasBilibiliSessionCookies,
  verify: verifyBilibiliIdentity,
  poll: async (page) => {
    if (!await hasBilibiliSessionCookies(page)) {
      throw new AuthRequiredError('bilibili.com', 'Waiting for Bilibili session cookies');
    }
    return verifyBilibiliIdentity(page);
  },
});
