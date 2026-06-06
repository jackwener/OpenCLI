import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasRednoteSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.rednote.com' });
  return cookies.some(c => c.name === 'web_session' && c.value);
}

async function verifyRednoteIdentity(page) {
  if (!await hasRednoteSessionCookie(page)) {
    throw new AuthRequiredError('rednote.com', 'Rednote web_session cookie missing');
  }
  await page.goto('https://www.rednote.com/explore');
  await page.wait(2);
  const probe = await page.evaluate(`
    (() => {
      const state = window.__INITIAL_STATE__;
      if (!state?.user) {
        return { kind: 'auth', detail: 'Rednote __INITIAL_STATE__.user missing' };
      }
      const loggedIn = state.user.loggedIn?._value;
      const userInfo = state.user.userInfo?._value || {};
      if (loggedIn !== true) {
        return { kind: 'auth', detail: 'Rednote loggedIn._value=' + String(loggedIn) + ' — anonymous' };
      }
      const userId = String(userInfo.userId || userInfo.user_id || '');
      const nickname = String(userInfo.nickname || userInfo.name || '');
      if (!userId) {
        return { kind: 'auth', detail: 'Rednote logged-in but userId missing — stale session' };
      }
      return { ok: true, user_id: userId, nickname };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('rednote.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Rednote probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, nickname: probe.nickname };
}

registerSiteAuthCommands({
  site: 'rednote',
  domain: 'rednote.com',
  loginUrl: 'https://www.rednote.com/explore',
  columns: ['user_id', 'nickname'],
  quickCheck: hasRednoteSessionCookie,
  verify: verifyRednoteIdentity,
  poll: async (page) => {
    if (!await hasRednoteSessionCookie(page)) {
      throw new AuthRequiredError('rednote.com', 'Waiting for Rednote web_session cookie');
    }
    return verifyRednoteIdentity(page);
  },
});
