import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { STUDIO_API, SUNO_URL, getSunoDeviceId, sunoHeadersJs, unwrapEvaluateResult, waitForSunoSessionToken } from './utils.js';

async function hasSunoSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://suno.com' });
  if (cookies.some(c => c.name === '__session' && c.value)) return true;
  const clerkCookies = await page.getCookies({ url: 'https://clerk.suno.com' });
  return clerkCookies.some(c => c.name === '__session' && c.value);
}

async function verifySunoIdentity(page) {
  await page.goto(SUNO_URL);
  if (!await waitForSunoSessionToken(page)) {
    throw new AuthRequiredError('suno.com', 'Suno session did not become ready');
  }
  const deviceId = await getSunoDeviceId(page);
  const probe = unwrapEvaluateResult(await page.evaluate(`(async () => {
    try {
      const r = await fetch('${STUDIO_API}/api/session/', { headers: ${sunoHeadersJs(deviceId)} });
      if (r.status === 401 || r.status === 403) {
        return { kind: 'auth', detail: 'Suno session HTTP ' + r.status };
      }
      if (!r.ok) return { kind: 'http', httpStatus: r.status };
      const d = await r.json();
      const user = d?.user;
      if (!user?.id) {
        return { kind: 'auth', detail: 'Suno session has no user.id' };
      }
      return { ok: true, user_id: String(user.id), name: String(user.username || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`));
  if (probe?.kind === 'auth') throw new AuthRequiredError('suno.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Suno session API`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Suno whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Suno probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, name: probe.name };
}

registerSiteAuthCommands({
  site: 'suno',
  domain: 'suno.com',
  loginUrl: 'https://suno.com/?sign-in=true',
  columns: ['user_id', 'name'],
  quickCheck: hasSunoSessionCookie,
  verify: verifySunoIdentity,
  poll: async (page) => {
    if (!await hasSunoSessionCookie(page)) {
      throw new AuthRequiredError('suno.com', 'Waiting for Suno __session cookie');
    }
    return verifySunoIdentity(page);
  },
});
