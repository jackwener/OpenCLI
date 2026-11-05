import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { redditFetchJson, throwRedditFetchFailure } from './api.js';

async function hasRedditSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.reddit.com' });
  return cookies.some(c => c.name === 'reddit_session' && c.value);
}

async function verifyRedditIdentity(page) {
  await page.goto('https://www.reddit.com/');
  await page.wait(2);
  const result = await page.evaluate(`(async () => {
    const redditFetchJson = ${redditFetchJson.toString()};
    try {
      const res = await redditFetchJson('/api/me.json', { headers: { 'Accept': 'application/json' } });
      if (!res.ok) return { kind: 'fetch-failed', failure: res.failure };
      const d = res.data;
      const data = d && d.data;
      if (!data || !data.name) {
        return { kind: 'auth', detail: 'Reddit /api/me.json 200 but no data.name — anonymous' };
      }
      return { ok: true, username: String(data.name), id: String(data.id || '') };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'fetch-failed') throwRedditFetchFailure(result.failure, '/api/me.json');
  if (result?.kind === 'auth') throw new AuthRequiredError('reddit.com', result.detail);
  if (result?.kind === 'exception') throw new CommandExecutionError(`Reddit whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected Reddit probe: ${JSON.stringify(result)}`);
  return { username: result.username, id: result.id };
}

registerSiteAuthCommands({
  site: 'reddit',
  registerWhoami: false,
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
