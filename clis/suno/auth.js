import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasSunoClerkCookie(page) {
  const cookies = await page.getCookies({ url: 'https://clerk.suno.com' });
  // Clerk sets __client for anonymous sessions too; __session (the session JWT)
  // is present only when authenticated, so gate on it to avoid navigating away
  // mid-login.
  return cookies.some(c => c.name === '__session' && c.value);
}

async function verifySunoIdentity(page) {
  if (!await hasSunoClerkCookie(page)) {
    throw new AuthRequiredError('suno.com', 'Suno Clerk __session/__client cookie missing');
  }
  await page.goto('https://suno.com/');
  await page.wait(2);
  const probe = await page.evaluate(`(async () => {
    try {
      const r = await fetch('https://clerk.suno.com/v1/client?_clerk_js_version=5', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (r.status === 401 || r.status === 403) {
        return { kind: 'auth', detail: 'clerk.suno.com /v1/client HTTP ' + r.status };
      }
      if (!r.ok) return { kind: 'http', httpStatus: r.status };
      const d = await r.json();
      const sessions = d?.response?.sessions || [];
      if (!Array.isArray(sessions) || sessions.length === 0) {
        return { kind: 'auth', detail: 'clerk.suno.com sessions=[] — anonymous' };
      }
      const active = sessions.find(s => s.status === 'active') || sessions[0];
      const user = active?.user;
      if (!user?.id) {
        return { kind: 'auth', detail: 'clerk.suno.com session present but no user.id — stale session' };
      }
      return { ok: true, user_id: String(user.id), name: String(user.username || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (probe?.kind === 'auth') throw new AuthRequiredError('suno.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from clerk.suno.com`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Suno whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Suno probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, name: probe.name };
}

registerSiteAuthCommands({
  site: 'suno',
  domain: 'suno.com',
  loginUrl: 'https://suno.com/?sign-in=true',
  columns: ['user_id', 'name'],
  quickCheck: hasSunoClerkCookie,
  verify: verifySunoIdentity,
  poll: async (page) => {
    if (!await hasSunoClerkCookie(page)) {
      throw new AuthRequiredError('suno.com', 'Waiting for Suno Clerk __session/__client cookie');
    }
    return verifySunoIdentity(page);
  },
});
