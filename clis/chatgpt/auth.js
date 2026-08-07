import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasChatgptSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://chatgpt.com' });
  // Prefix match: NextAuth chunks large session tokens into
  // `__Secure-next-auth.session-token.0`, `.1`, … so an exact-name check
  // false-negatives on chunked sessions (the `auth status`/`refresh`/login
  // fast paths that consume this). See issue #2087.
  return cookies.some(c => c.name.startsWith('__Secure-next-auth.session-token') && c.value);
}

async function verifyChatgptIdentity(page) {
  // The `/api/auth/session` probe below is authoritative — do NOT pre-gate on the
  // legacy `__Secure-next-auth.session-token` cookie. Current ChatGPT web
  // sessions authenticate without that cookie, so gating on it produced false
  // AUTH_REQUIRED for logged-in users. See issue #2087.
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
  // Poll keeps the cheap, non-navigating cookie gate: during `login` the browser
  // sits on the OAuth page, and verify (which navigates to chatgpt.com) must not
  // run every ~2s or it would yank the user off the login form. #2087 is about
  // `whoami` (the verify path above); login-completion detection is unchanged.
  poll: async (page) => {
    if (!await hasChatgptSessionCookie(page)) {
      throw new AuthRequiredError('chatgpt.com', 'Waiting for ChatGPT session cookie');
    }
    return verifyChatgptIdentity(page);
  },
});
