import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasRedditSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.reddit.com' });
  return cookies.some(c => c.name === 'reddit_session' && c.value);
}

async function verifyRedditIdentity(page) {
  if (!await hasRedditSessionCookie(page)) {
    throw new AuthRequiredError('reddit.com', 'Reddit reddit_session cookie missing');
  }
  await page.goto('https://www.reddit.com/');
  await page.wait(2);
  const result = await page.evaluate(`(async () => {
    try {
      const res = await fetch('/api/me.json', { credentials: 'include', headers: { 'Accept': 'application/json' } });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'Reddit /api/me.json HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      const data = d && d.data;
      if (!data || !data.name) {
        return { kind: 'auth', detail: 'Reddit /api/me.json 200 but no data.name — anonymous' };
      }
      return { ok: true, username: String(data.name), id: String(data.id || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('reddit.com', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /api/me.json`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`Reddit whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected Reddit probe: ${JSON.stringify(result)}`);
  return { username: result.username, id: result.id };
}

registerSiteAuthCommands({
  site: 'reddit',
  domain: 'reddit.com',
  loginUrl: 'https://www.reddit.com/login',
  columns: ['username', 'id'],
  quickCheck: hasRedditSessionCookie,
  verify: verifyRedditIdentity,
  poll: async (page) => {
    if (!await hasRedditSessionCookie(page)) {
      throw new AuthRequiredError('reddit.com', 'Waiting for Reddit reddit_session cookie');
    }
    return verifyRedditIdentity(page);
  },
});
