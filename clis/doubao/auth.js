import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasDoubaoSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.doubao.com' });
  return cookies.some(c => c.name === 'passport_csrf_token' && c.value);
}

async function verifyDoubaoIdentity(page) {
  if (!await hasDoubaoSessionCookie(page)) {
    throw new AuthRequiredError('www.doubao.com', 'Doubao passport_csrf_token cookie missing');
  }
  await page.goto('https://www.doubao.com/chat/');
  await page.wait(3);
  const result = await page.evaluate(`(async () => {
    try {
      const res = await fetch('/passport/account/info/v2/', { credentials: 'include', headers: { 'Accept': 'application/json' } });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'Doubao /passport/account/info HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      const data = d && d.data;
      if (!data || !data.user_id_str) {
        return { kind: 'auth', detail: 'Doubao /passport/account/info returned no user_id_str' };
      }
      return {
        ok: true,
        user_id: String(data.user_id_str),
        name: String(data.name || data.screen_name || ''),
      };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('www.doubao.com', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /passport/account/info`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`Doubao whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected Doubao probe: ${JSON.stringify(result)}`);
  return { user_id: result.user_id, name: result.name };
}

registerSiteAuthCommands({
  site: 'doubao',
  domain: 'www.doubao.com',
  loginUrl: 'https://www.doubao.com/chat/',
  columns: ['user_id', 'name'],
  verify: verifyDoubaoIdentity,
  // passport_csrf_token is set for anonymous sessions too, so a cookie gate
  // would navigate away mid-login. Probe the account API on the current page
  // (no goto) and only confirm once a real user_id is present.
  poll: async (page) => {
    const loggedIn = await page.evaluate(`(async () => {
      try {
        const r = await fetch('/passport/account/info/v2/', { credentials: 'include', headers: { Accept: 'application/json' } });
        if (!r.ok) return false;
        const d = await r.json();
        return !!(d?.data?.user_id_str);
      } catch { return false; }
    })()`);
    if (!loggedIn) {
      throw new AuthRequiredError('www.doubao.com', 'Waiting for Doubao login');
    }
    return verifyDoubaoIdentity(page);
  },
});
