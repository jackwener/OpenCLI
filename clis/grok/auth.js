import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

// Grok has rotated its session cookie names more than once
// (`__Secure-next-auth.session-token`, then the xAI `sso` / `sso-rw` pair and
// `x-userid`). The cookie list is only a hint for the cheap auth-status check
// and for login polling; the authoritative answer is /api/auth/session below.
// Tracking cookies whose meaning is unconfirmed (`__cuid`, `sa-user-id`) are
// left out so the hint cannot report an anonymous visitor as signed in.
const GROK_SESSION_COOKIE_HINTS = [
  '__Secure-next-auth.session-token',
  '__Secure-authjs.session-token',
  'sso',
  'sso-rw',
  'x-userid',
];

async function hasGrokSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://grok.com' });
  const names = new Set(cookies.filter(c => c.value).map(c => c.name));
  return GROK_SESSION_COOKIE_HINTS.some(name => names.has(name));
}

async function verifyGrokIdentity(page) {
  await page.goto('https://grok.com/');
  await page.wait(2);
  const result = await page.evaluate(`(async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include', headers: { 'Accept': 'application/json' } });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'Grok /api/auth/session HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      // Current shape: { status: "authenticated", session: { userId, email, xUsername } }
      // Older shape: { user: { id, name } } — keep both readable.
      const session = d && d.session;
      const user = d && d.user;
      const authenticated = (d && d.status === 'authenticated')
        || !!(user && user.id)
        || !!(session && session.userId);
      if (!authenticated) {
        return { kind: 'auth', detail: 'Grok /api/auth/session is not authenticated — anonymous' };
      }
      const userId = (session && session.userId) || (user && user.id) || '';
      const name = (session && (session.xUsername || session.email || session.name))
        || (user && (user.name || user.email))
        || '';
      return { ok: true, user_id: String(userId || ''), name: String(name || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('grok.com', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /api/auth/session`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`Grok whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected Grok probe: ${JSON.stringify(result)}`);
  return { user_id: result.user_id, name: result.name };
}

registerSiteAuthCommands({
  site: 'grok',
  domain: 'grok.com',
  loginUrl: 'https://grok.com/auth/sign-in',
  columns: ['user_id', 'name'],
  quickCheck: hasGrokSessionCookie,
  verify: verifyGrokIdentity,
  // Polling runs while the user is on the sign-in page; verify navigates to
  // grok.com, so only call it once a session cookie hint has appeared.
  poll: async (page) => {
    if (!await hasGrokSessionCookie(page)) {
      throw new AuthRequiredError('grok.com', 'Waiting for Grok session cookie');
    }
    return verifyGrokIdentity(page);
  },
});
