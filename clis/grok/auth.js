import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasGrokSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://grok.com' });
  return cookies.some(c => c.name === '__Secure-next-auth.session-token' && c.value);
}

async function verifyGrokIdentity(page) {
  if (!await hasGrokSessionCookie(page)) {
    throw new AuthRequiredError('grok.com', 'Grok __Secure-next-auth.session-token cookie missing');
  }
  await page.goto('https://grok.com/');
  await page.wait(2);
  const result = await page.evaluate(`(async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include', headers: { 'Accept': 'application/json' } });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'Grok /api/auth/session HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      const user = d && d.user;
      if (!user || !user.id) {
        return { kind: 'auth', detail: 'Grok /api/auth/session has no user — anonymous' };
      }
      return { ok: true, user_id: String(user.id), name: String(user.name || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('grok.com', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /api/auth/session`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`Grok whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected Grok probe: ${JSON.stringify(result)}`);
  return { user_id: result.user_id, name: result.name };
}

registerSiteAuthCommands({
  site: 'grok',
  domain: 'grok.com',
  loginUrl: 'https://grok.com/auth/sign-in',
  columns: ['user_id', 'name'],
  quickCheck: hasGrokSessionCookie,
  verify: verifyGrokIdentity,
  poll: async (page) => {
    if (!await hasGrokSessionCookie(page)) {
      throw new AuthRequiredError('grok.com', 'Waiting for Grok session cookie');
    }
    return verifyGrokIdentity(page);
  },
});
