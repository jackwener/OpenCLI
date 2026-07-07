import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// NextAuth chunks a large session token into `...session-token.0`, `.1`, …, so
// match by prefix rather than the exact legacy name (which current ChatGPT
// sessions may no longer set verbatim) — see #2087.
async function hasChatgptSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://chatgpt.com' });
  return cookies.some(c => c.name.startsWith('__Secure-next-auth.session-token') && c.value);
}

function unwrapEvaluateResult(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

function buildChatgptIdentityProbe() {
  return `(async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include', headers: { 'Accept': 'application/json' } });
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
  })()`;
}

async function verifyChatgptIdentity(page) {
  // /api/auth/session is the authoritative login check, so don't pre-gate on a
  // specific cookie name: current sessions can be authenticated without the
  // legacy __Secure-next-auth.session-token, and chunked tokens use a different
  // name. Gating here caused false AUTH_REQUIRED for logged-in users (#2087).
  await page.goto('https://chatgpt.com/');
  await page.wait(2);
  const result = unwrapEvaluateResult(await page.evaluate(buildChatgptIdentityProbe()));
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

export const __test__ = { buildChatgptIdentityProbe, verifyChatgptIdentity, hasChatgptSessionCookie, unwrapEvaluateResult };
