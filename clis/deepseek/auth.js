import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// DeepSeek authenticates via a Bearer token stored in localStorage (userToken),
// not a cookie, so credentials:include alone returns code 40002 (anonymous).
// The probe reads the token and calls the confirmed /api/v0/users/current
// endpoint (anonymous → HTTP 200 + body code 40002).
const WHOAMI_PROBE = `(async () => {
  try {
    let token = '';
    const raw = localStorage.getItem('userToken');
    if (raw) { try { token = JSON.parse(raw).value || ''; } catch { token = raw; } }
    if (!token) return { kind: 'auth', detail: 'DeepSeek userToken missing from localStorage — anonymous' };
    const r = await fetch('/api/v0/users/current', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    });
    if (r.status === 401 || r.status === 403) return { kind: 'auth', detail: 'DeepSeek users/current HTTP ' + r.status };
    if (!r.ok) return { kind: 'http', httpStatus: r.status };
    const d = await r.json();
    if (!d || d.code !== 0) return { kind: 'auth', detail: 'DeepSeek users/current code=' + String(d && d.code) + ' — anonymous' };
    const u = (d.data && (d.data.biz_data || d.data.user || d.data)) || {};
    const userId = String(u.id || u.user_id || u.uuid || '');
    const name = String(u.name || u.nickname || u.username || '');
    if (!userId && !name) return { kind: 'render-error', detail: 'DeepSeek users/current ok but no id/name field — response shape drift' };
    return { ok: true, user_id: userId, name };
  } catch (e) {
    return { kind: 'exception', detail: String(e && e.message || e) };
  }
})()`;

async function verifyDeepseekIdentity(page) {
  await page.goto('https://chat.deepseek.com/');
  await page.wait(2);
  const probe = await page.evaluate(WHOAMI_PROBE);
  if (probe?.kind === 'auth') throw new AuthRequiredError('chat.deepseek.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from DeepSeek users/current`);
  if (probe?.kind === 'render-error') throw new CommandExecutionError(probe.detail);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`DeepSeek whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected DeepSeek probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, name: probe.name };
}

registerSiteAuthCommands({
  site: 'deepseek',
  domain: 'chat.deepseek.com',
  loginUrl: 'https://chat.deepseek.com/sign_in',
  columns: ['user_id', 'name'],
  verify: verifyDeepseekIdentity,
  poll: async (page) => {
    const probe = await page.evaluate(WHOAMI_PROBE);
    if (!probe?.ok) throw new AuthRequiredError('chat.deepseek.com', 'Waiting for DeepSeek login');
    return { user_id: probe.user_id, name: probe.name };
  },
});
