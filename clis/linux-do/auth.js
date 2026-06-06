import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasLinuxDoSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://linux.do' });
  return cookies.some(c => c.name === '_t' && c.value);
}

async function verifyLinuxDoIdentity(page) {
  if (!await hasLinuxDoSessionCookie(page)) {
    throw new AuthRequiredError('linux.do', 'Linux.do _t cookie missing — anonymous');
  }
  await page.goto('https://linux.do/');
  await page.wait(2);
  const probe = await page.evaluate(`(async () => {
    try {
      const u = document.querySelector('meta[name="current-user-username"]')?.getAttribute('content') || '';
      if (!u) return { kind: 'auth', detail: 'Linux.do meta[current-user-username] missing — anonymous' };
      const r = await fetch('/u/' + encodeURIComponent(u) + '.json', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (r.status === 401 || r.status === 403) {
        return { kind: 'auth', detail: 'Linux.do /u/<self>.json HTTP ' + r.status };
      }
      if (!r.ok) return { kind: 'http', httpStatus: r.status };
      const d = await r.json();
      const user = d?.user;
      if (!user || !user.id) return { kind: 'auth', detail: 'Linux.do /u/<self>.json missing user.id' };
      return { ok: true, user_id: String(user.id), username: String(user.username || u), name: String(user.name || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (probe?.kind === 'auth') throw new AuthRequiredError('linux.do', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Linux.do /u/<self>.json`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Linux.do whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Linux.do probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, username: probe.username, name: probe.name };
}

registerSiteAuthCommands({
  site: 'linux-do',
  domain: 'linux.do',
  loginUrl: 'https://linux.do/login',
  columns: ['user_id', 'username', 'name'],
  quickCheck: hasLinuxDoSessionCookie,
  verify: verifyLinuxDoIdentity,
  poll: async (page) => {
    if (!await hasLinuxDoSessionCookie(page)) {
      throw new AuthRequiredError('linux.do', 'Waiting for Linux.do _t cookie');
    }
    return verifyLinuxDoIdentity(page);
  },
});
