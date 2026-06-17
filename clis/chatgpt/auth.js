import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasChatgptSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://chatgpt.com' });
  return cookies.some(c => c.name === '__Secure-next-auth.session-token' && c.value);
}

async function verifyChatgptIdentity(page) {
  if (!await hasChatgptSessionCookie(page)) {
    throw new AuthRequiredError('chatgpt.com', 'ChatGPT __Secure-next-auth.session-token cookie missing');
  }
  await page.goto('https://chatgpt.com/');
  await page.wait(2);
  const result = await page.evaluate(`(async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'ChatGPT /api/auth/session HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      const user = d && d.user;
      if (!user || !user.id) {
        return { kind: 'auth', detail: 'ChatGPT /api/auth/session has no user — anonymous' };
      }
      return { ok: true, user_id: String(user.id), name: String(user.name || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('chatgpt.com', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /api/auth/session`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`ChatGPT whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected ChatGPT probe: ${JSON.stringify(result)}`);
  return { user_id: result.user_id, name: result.name };
}

registerSiteAuthCommands({
  site: 'chatgpt',
  domain: 'chatgpt.com',
  loginUrl: 'https://auth.openai.com/log-in',
  columns: ['user_id', 'name'],
  quickCheck: hasChatgptSessionCookie,
  verify: verifyChatgptIdentity,
  poll: async (page) => {
    if (!await hasChatgptSessionCookie(page)) {
      throw new AuthRequiredError('chatgpt.com', 'Waiting for ChatGPT session cookie');
    }
    return verifyChatgptIdentity(page);
  },
});
