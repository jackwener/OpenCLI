import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// Jike web (web.okjike.com) is an SPA shell that stores a JWT in localStorage
// under JK_ACCESS_TOKEN and forwards it as the x-jike-access-token header to the
// api.ruguoapp.com gateway. The JWT payload is encrypted, so identity is read
// from the /1.0/users/profile endpoint rather than from the token or a cookie.
const WHOAMI_PROBE = `(async () => {
  try {
    const token = localStorage.getItem('JK_ACCESS_TOKEN') || '';
    if (!token) return { kind: 'auth', detail: 'Jike JK_ACCESS_TOKEN missing from localStorage (anonymous)' };
    const r = await fetch('https://api.ruguoapp.com/1.0/users/profile', {
      headers: { 'x-jike-access-token': token, Accept: 'application/json' },
    });
    if (r.status === 401 || r.status === 403) return { kind: 'auth', detail: 'Jike users/profile HTTP ' + r.status };
    if (!r.ok) return { kind: 'http', httpStatus: r.status };
    const d = await r.json();
    const u = d && d.user;
    if (!u || !u.id) return { kind: 'auth', detail: 'Jike users/profile returned no user (anonymous)' };
    return { ok: true, user_id: String(u.id), screen_name: String(u.screenName || ''), username: String(u.username || '') };
  } catch (e) {
    return { kind: 'exception', detail: String(e && e.message || e) };
  }
})()`;

async function verifyJikeIdentity(page) {
  await page.goto('https://web.okjike.com/');
  await page.wait(2);
  const probe = await page.evaluate(WHOAMI_PROBE);
  if (probe?.kind === 'auth') throw new AuthRequiredError('web.okjike.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Jike users/profile`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Jike whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Jike probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, screen_name: probe.screen_name, username: probe.username };
}

registerSiteAuthCommands({
  site: 'jike',
  domain: 'web.okjike.com',
  loginUrl: 'https://web.okjike.com/login',
  columns: ['user_id', 'screen_name', 'username'],
  verify: verifyJikeIdentity,
  poll: async (page) => {
    const probe = await page.evaluate(WHOAMI_PROBE);
    if (!probe?.ok) throw new AuthRequiredError('web.okjike.com', 'Waiting for Jike login');
    return { user_id: probe.user_id, screen_name: probe.screen_name, username: probe.username };
  },
});
