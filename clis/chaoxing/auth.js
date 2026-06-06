import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasChaoxingSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://i.chaoxing.com' });
  return cookies.some(c => /^(UID|_uid|chaoxinguser|cx_p_token)$/i.test(c.name) && c.value);
}

async function verifyChaoxingIdentity(page) {
  if (!await hasChaoxingSessionCookie(page)) {
    throw new AuthRequiredError('chaoxing.com', 'Chaoxing session cookies missing');
  }
  await page.goto('https://i.chaoxing.com/');
  await page.wait(3);
  const probe = await page.evaluate(`
    (() => {
      if (/passport2\\.chaoxing\\.com\\/login/.test(location.href)) {
        return { kind: 'auth', detail: 'Chaoxing i.chaoxing.com redirected to passport2 login' };
      }
      const userIdCookie = (document.cookie.split('; ').find(c => /^(_uid|UID)=/.test(c)) || '').split('=')[1] || '';
      let userName = '';
      const unameCookie = (document.cookie.split('; ').find(c => /^uname=/.test(c)) || '').split('=')[1] || '';
      if (unameCookie) {
        try { userName = decodeURIComponent(unameCookie); } catch { userName = unameCookie; }
      }
      if (!userName) {
        const el = document.querySelector('.userTitle, .myInfo, .user-name, [class*=userName]');
        userName = (el?.innerText || '').trim();
      }
      if (!userIdCookie && !userName) {
        return { kind: 'auth', detail: 'Chaoxing i.chaoxing.com no user identity surface — anonymous' };
      }
      return { ok: true, user_id: userIdCookie, name: userName };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('chaoxing.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Chaoxing probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, name: probe.name };
}

registerSiteAuthCommands({
  site: 'chaoxing',
  domain: 'chaoxing.com',
  loginUrl: 'https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https%3A%2F%2Fi.chaoxing.com',
  columns: ['user_id', 'name'],
  quickCheck: hasChaoxingSessionCookie,
  verify: verifyChaoxingIdentity,
  poll: async (page) => {
    if (!await hasChaoxingSessionCookie(page)) {
      throw new AuthRequiredError('chaoxing.com', 'Waiting for Chaoxing session cookies');
    }
    return verifyChaoxingIdentity(page);
  },
});
