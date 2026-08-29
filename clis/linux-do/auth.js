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
      const r = await fetch('/session/current.json', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (r.status === 401 || r.status === 403) {
        return { kind: 'auth', detail: 'Linux.do /session/current.json HTTP ' + r.status };
      }
      if (!r.ok) return { kind: 'http', httpStatus: r.status };
      const d = await r.json();
      const user = d?.current_user;
      if (!user || !user.id || !user.username) {
        return { kind: 'auth', detail: 'Linux.do /session/current.json missing current_user' };
      }
      return {
        ok: true,
        user_id: String(user.id),
        username: String(user.username),
        name: String(user.name || ''),
      };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (probe?.kind === 'auth') throw new AuthRequiredError('linux.do', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Linux.do /session/current.json`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Linux.do whoami failed: ${probe.detail}`);
  if (!probe?.ok || !probe.user_id || !probe.username) {
    throw new CommandExecutionError(`Unexpected Linux.do probe: ${JSON.stringify(probe)}`);
  }
  return { user_id: probe.user_id, username: probe.username, name: probe.name };
}

export const __test__ = { verifyLinuxDoIdentity };

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
