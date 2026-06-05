import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasManusSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://manus.im' });
  return cookies.some(c => /^(auth_session|manus_token|_session|session)$/.test(c.name) && c.value);
}

async function verifyManusIdentity(page) {
  if (!await hasManusSessionCookie(page)) {
    throw new AuthRequiredError('manus.im', 'Manus session cookies missing — anonymous');
  }
  await page.goto('https://manus.im/');
  await page.wait(3);
  const probe = await page.evaluate(`(async () => {
    try {
      const r = await fetch('/api/auth/session', { credentials: 'include', headers: { Accept: 'application/json' } });
      if (r.status === 401 || r.status === 403) {
        return { kind: 'auth', detail: 'Manus /api/auth/session HTTP ' + r.status };
      }
      if (r.status === 503) {
        return { kind: 'http', httpStatus: 503 };
      }
      if (!r.ok) return { kind: 'http', httpStatus: r.status };
      const d = await r.json();
      const u = d?.user || d;
      if (!u || !(u.id || u.userId)) {
        return { kind: 'auth', detail: 'Manus /api/auth/session 200 but no user' };
      }
      return { ok: true, user_id: String(u.id || u.userId), name: String(u.name || u.displayName || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (probe?.kind === 'auth') throw new AuthRequiredError('manus.im', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Manus /api/auth/session`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Manus whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Manus probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, name: probe.name };
}

registerSiteAuthCommands({
  site: 'manus',
  domain: 'manus.im',
  loginUrl: 'https://manus.im/login',
  columns: ['user_id', 'name'],
  verify: verifyManusIdentity,
  poll: async (page) => {
    if (!await hasManusSessionCookie(page)) {
      throw new AuthRequiredError('manus.im', 'Waiting for Manus session cookies');
    }
    return verifyManusIdentity(page);
  },
});
