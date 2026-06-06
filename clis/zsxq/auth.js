import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// zsxq auth cookies are all httpOnly and span multiple subdomains
// (wx.zsxq.com / api.zsxq.com / .zsxq.com), so document.cookie / cookie
// probes are unreliable. Verify via a lightweight API 401 probe instead.
async function verifyZsxqIdentity(page) {
  await page.goto('https://wx.zsxq.com/');
  await page.wait(2);
  const probe = await page.evaluate(`
    (async () => {
      const url = location.href;
      if (/\\/login(\\b|$)/.test(url)) {
        return { kind: 'auth', detail: 'zsxq wx page redirected to /login — anonymous session' };
      }
      try {
        const r = await fetch('https://api.zsxq.com/v2/users/self', {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (r.status === 401 || r.status === 403) {
          return { kind: 'auth', detail: 'zsxq /v2/users/self returned HTTP ' + r.status };
        }
        if (!r.ok) return { kind: 'http', httpStatus: r.status };
        const d = await r.json();
        if (d?.succeeded === false || !d?.resp_data?.user) {
          return { kind: 'auth', detail: 'zsxq /v2/users/self returned succeeded=false — anonymous' };
        }
        const u = d.resp_data.user;
        return { ok: true, user_id: String(u.user_id || u.id || ''), name: String(u.name || u.nickname || '') };
      } catch (e) {
        return { kind: 'exception', detail: String(e && e.message || e) };
      }
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('zsxq.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from zsxq /v2/users/self`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`zsxq whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected zsxq probe: ${JSON.stringify(probe)}`);
  if (!probe.user_id) {
    throw new AuthRequiredError('zsxq.com', 'zsxq /v2/users/self 200 but user_id missing — incomplete session');
  }
  return { user_id: probe.user_id, name: probe.name };
}

registerSiteAuthCommands({
  site: 'zsxq',
  domain: 'zsxq.com',
  loginUrl: 'https://wx.zsxq.com/login',
  columns: ['user_id', 'name'],
  verify: verifyZsxqIdentity,
  // No-navigation poll: probe the API from the current page so the login-page
  // QR code isn't reset by a goto on every interval.
  poll: async (page) => {
    const loggedIn = await page.evaluate(`(async () => {
      try {
        const r = await fetch('https://api.zsxq.com/v2/users/self', { credentials: 'include', headers: { Accept: 'application/json' } });
        if (!r.ok) return false;
        const d = await r.json();
        return !!(d?.resp_data?.user);
      } catch { return false; }
    })()`);
    if (!loggedIn) {
      throw new AuthRequiredError('zsxq.com', 'Waiting for zsxq login');
    }
    return verifyZsxqIdentity(page);
  },
});
