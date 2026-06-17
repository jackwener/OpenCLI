import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// Jimeng (ByteDance) authenticates through the shared jianying passport. The
// /passport/account/info/v2/ endpoint returns the current account for the
// session cookies; an anonymous visitor comes back with is_visitor_account
// true and no user_id, so that flag is the login gate. Only the stable id and
// display name are surfaced (the payload also carries phone/email, which are
// intentionally not read).
const WHOAMI_PROBE = `(async () => {
  try {
    const r = await fetch('/passport/account/info/v2/?aid=513695', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (r.status === 401 || r.status === 403) return { kind: 'auth', detail: 'Jimeng passport HTTP ' + r.status };
    if (!r.ok) return { kind: 'http', httpStatus: r.status };
    const d = await r.json();
    const u = d && d.data;
    if (!u || !u.user_id || u.is_visitor_account) return { kind: 'auth', detail: 'Jimeng passport returned a visitor account (anonymous)' };
    return { ok: true, user_id: String(u.user_id_str || u.user_id), screen_name: String(u.screen_name || u.name || '') };
  } catch (e) {
    return { kind: 'exception', detail: String(e && e.message || e) };
  }
})()`;

async function verifyJimengIdentity(page) {
  await page.goto('https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0');
  await page.wait(2);
  const probe = await page.evaluate(WHOAMI_PROBE);
  if (probe?.kind === 'auth') throw new AuthRequiredError('jimeng.jianying.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Jimeng passport`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Jimeng whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Jimeng probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, screen_name: probe.screen_name };
}

registerSiteAuthCommands({
  site: 'jimeng',
  domain: 'jimeng.jianying.com',
  loginUrl: 'https://jimeng.jianying.com/',
  columns: ['user_id', 'screen_name'],
  verify: verifyJimengIdentity,
  poll: async (page) => {
    const probe = await page.evaluate(WHOAMI_PROBE);
    if (!probe?.ok) throw new AuthRequiredError('jimeng.jianying.com', 'Waiting for Jimeng login');
    return { user_id: probe.user_id, screen_name: probe.screen_name };
  },
});
