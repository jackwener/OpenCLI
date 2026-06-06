import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasKimiSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.kimi.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('access_token') || names.has('refresh_token');
}

async function verifyKimiIdentity(page) {
  // Source the token via CDP getCookies (works even if access_token is httpOnly,
  // which document.cookie cannot read).
  const cookies = await page.getCookies({ url: 'https://www.kimi.com' });
  const token = cookies.find(c => c.name === 'access_token')?.value || '';
  if (!token) {
    throw new AuthRequiredError('kimi.com', 'Kimi access_token cookie missing');
  }
  await page.goto('https://www.kimi.com/');
  await page.wait(3);
  const result = await page.evaluate(`(async () => {
    try {
      const token = ${JSON.stringify(token)};
      const res = await fetch('/api/user', { credentials: 'include', headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' } });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'Kimi /api/user HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      if (!d || !d.id) {
        return { kind: 'auth', detail: 'Kimi /api/user returned no id — anonymous' };
      }
      return { ok: true, user_id: String(d.id), name: String(d.name || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('kimi.com', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /api/user`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`Kimi whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected Kimi probe: ${JSON.stringify(result)}`);
  return { user_id: result.user_id, name: result.name };
}

registerSiteAuthCommands({
  site: 'kimi',
  domain: 'kimi.com',
  loginUrl: 'https://www.kimi.com/',
  columns: ['user_id', 'name'],
  quickCheck: hasKimiSessionCookie,
  verify: verifyKimiIdentity,
  poll: async (page) => {
    if (!await hasKimiSessionCookie(page)) {
      throw new AuthRequiredError('kimi.com', 'Waiting for Kimi auth cookies');
    }
    return verifyKimiIdentity(page);
  },
});
