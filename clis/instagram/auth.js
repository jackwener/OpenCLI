import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasInstagramSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.instagram.com' });
  return cookies.some(c => c.name === 'sessionid' && c.value);
}

async function verifyInstagramIdentity(page) {
  if (!await hasInstagramSessionCookie(page)) {
    throw new AuthRequiredError('www.instagram.com', 'Instagram sessionid cookie missing');
  }
  await page.goto('https://www.instagram.com/');
  await page.wait(2);
  const result = await page.evaluate(`(async () => {
    try {
      const uid = (document.cookie.split('; ').find(c => c.startsWith('ds_user_id=')) || '').split('=')[1] || '';
      if (!uid) return { kind: 'auth', detail: 'Instagram ds_user_id cookie missing' };
      const r = await fetch('/api/v1/users/' + uid + '/info/', {
        credentials: 'include',
        headers: { 'X-IG-App-ID': '936619743392459', 'Accept': 'application/json' },
      });
      if (r.status === 401 || r.status === 403) {
        return { kind: 'auth', detail: 'Instagram /users/info HTTP ' + r.status };
      }
      if (!r.ok) return { kind: 'http', httpStatus: r.status };
      const d = await r.json();
      const user = d?.user;
      if (!user || !user.pk) {
        return { kind: 'auth', detail: 'Instagram /users/info returned no pk — session likely expired' };
      }
      return { ok: true, user_id: String(user.pk), username: String(user.username || ''), full_name: String(user.full_name || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('www.instagram.com', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from Instagram /users/info`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`Instagram whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected Instagram probe: ${JSON.stringify(result)}`);
  return { user_id: result.user_id, username: result.username, full_name: result.full_name };
}

registerSiteAuthCommands({
  site: 'instagram',
  domain: 'instagram.com',
  loginUrl: 'https://www.instagram.com/accounts/login/',
  columns: ['user_id', 'username', 'full_name'],
  quickCheck: hasInstagramSessionCookie,
  verify: verifyInstagramIdentity,
  poll: async (page) => {
    if (!await hasInstagramSessionCookie(page)) {
      throw new AuthRequiredError('www.instagram.com', 'Waiting for Instagram sessionid cookie');
    }
    return verifyInstagramIdentity(page);
  },
});
