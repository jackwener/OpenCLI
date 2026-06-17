import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasQwenSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://chat.qwen.ai' });
  return cookies.some(c => c.name === 'token' && c.value);
}

async function verifyQwenIdentity(page) {
  // Source the token via CDP getCookies (works even if `token` is httpOnly,
  // which document.cookie cannot read).
  const cookies = await page.getCookies({ url: 'https://chat.qwen.ai' });
  const token = cookies.find(c => c.name === 'token')?.value || '';
  if (!token) {
    throw new AuthRequiredError('qwen.ai', 'Qwen token cookie missing');
  }
  await page.goto('https://chat.qwen.ai/');
  await page.wait(2);
  const result = await page.evaluate(`(async () => {
    try {
      const token = ${JSON.stringify(token)};
      const res = await fetch('/api/v1/auths/', { credentials: 'include', headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' } });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'Qwen /api/v1/auths/ HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      if (!d || !d.id) {
        return { kind: 'auth', detail: 'Qwen /api/v1/auths/ returned no user id' };
      }
      return { ok: true, user_id: String(d.id), name: String(d.name || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('qwen.ai', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /api/v1/auths/`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`Qwen whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected Qwen probe: ${JSON.stringify(result)}`);
  return { user_id: result.user_id, name: result.name };
}

registerSiteAuthCommands({
  site: 'qwen',
  domain: 'qwen.ai',
  loginUrl: 'https://chat.qwen.ai/auth?action=login',
  columns: ['user_id', 'name'],
  quickCheck: hasQwenSessionCookie,
  verify: verifyQwenIdentity,
  poll: async (page) => {
    if (!await hasQwenSessionCookie(page)) {
      throw new AuthRequiredError('qwen.ai', 'Waiting for Qwen token cookie');
    }
    return verifyQwenIdentity(page);
  },
});
