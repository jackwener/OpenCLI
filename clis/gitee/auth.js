import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// Gitee's logged-in cookie (gitee-session-n) is httpOnly and its exact name
// rotates, so the poll uses a no-navigation API probe instead of a cookie gate.
const WHOAMI_PROBE = `(async () => {
  try {
    const r = await fetch('/api/v5/user', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (r.status === 401 || r.status === 403) return { kind: 'auth', detail: 'Gitee /api/v5/user HTTP ' + r.status };
    if (!r.ok) return { kind: 'http', httpStatus: r.status };
    const d = await r.json();
    if (!d || !d.id || !d.login) return { kind: 'auth', detail: 'Gitee /api/v5/user has no id/login — anonymous' };
    return { ok: true, user_id: String(d.id), username: String(d.login), name: String(d.name || '') };
  } catch (e) {
    return { kind: 'exception', detail: String(e && e.message || e) };
  }
})()`;

async function verifyGiteeIdentity(page) {
  await page.goto('https://gitee.com/');
  await page.wait(1);
  const probe = await page.evaluate(WHOAMI_PROBE);
  if (probe?.kind === 'auth') throw new AuthRequiredError('gitee.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Gitee /api/v5/user`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Gitee whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Gitee probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, username: probe.username, name: probe.name };
}

registerSiteAuthCommands({
  site: 'gitee',
  domain: 'gitee.com',
  loginUrl: 'https://gitee.com/login',
  columns: ['user_id', 'username', 'name'],
  verify: verifyGiteeIdentity,
  poll: async (page) => {
    const probe = await page.evaluate(WHOAMI_PROBE);
    if (!probe?.ok) throw new AuthRequiredError('gitee.com', 'Waiting for Gitee login');
    return { user_id: probe.user_id, username: probe.username, name: probe.name };
  },
});
