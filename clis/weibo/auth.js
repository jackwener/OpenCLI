import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasWeiboSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://weibo.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('SUB') && names.has('SUBP');
}

async function verifyWeiboIdentity(page) {
  if (!await hasWeiboSessionCookie(page)) {
    throw new AuthRequiredError('weibo.com', 'Weibo SUB / SUBP cookies missing');
  }
  await page.goto('https://weibo.com/');
  await page.wait(3);
  const result = await page.evaluate(`(async () => {
    try {
      const res = await fetch('/ajax/profile/info', { credentials: 'include', headers: { 'Accept': 'application/json' } });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'Weibo /ajax/profile/info HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      const user = d && d.data && d.data.user;
      if (!user || !user.id) {
        return { kind: 'auth', detail: 'Weibo /ajax/profile/info returned no user — anonymous' };
      }
      return { ok: true, user_id: String(user.id), screen_name: String(user.screen_name || ''), profile_url: String(user.profile_url || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('weibo.com', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /ajax/profile/info`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`Weibo whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected Weibo probe: ${JSON.stringify(result)}`);
  return { user_id: result.user_id, screen_name: result.screen_name, profile_url: result.profile_url };
}

registerSiteAuthCommands({
  site: 'weibo',
  domain: 'weibo.com',
  loginUrl: 'https://weibo.com/login',
  columns: ['user_id', 'screen_name', 'profile_url'],
  quickCheck: hasWeiboSessionCookie,
  verify: verifyWeiboIdentity,
  poll: async (page) => {
    if (!await hasWeiboSessionCookie(page)) {
      throw new AuthRequiredError('weibo.com', 'Waiting for Weibo SUB / SUBP cookies');
    }
    return verifyWeiboIdentity(page);
  },
});
