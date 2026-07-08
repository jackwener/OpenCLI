import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasBandSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.band.us' });
  return cookies.some(c => c.name === 'band_session' && c.value);
}

async function verifyBandIdentity(page) {
  if (!await hasBandSessionCookie(page)) {
    throw new AuthRequiredError('band.us', 'Band band_session cookie missing');
  }
  await page.goto('https://www.band.us/feed');
  await page.wait(2);
  const probe = await page.evaluate(`
    (() => {
      if (/auth\\.band\\.us\\/login/.test(location.href)) {
        return { kind: 'auth', detail: 'Band /feed redirected to auth login' };
      }
      let userId = '';
      try {
        const stack = [window.__INITIAL_STATE__, window.__BAND_STORE__].filter(Boolean);
        const seen = new Set();
        while (stack.length) {
          const node = stack.pop();
          if (!node || typeof node !== 'object' || seen.has(node)) continue;
          seen.add(node);
          if (Array.isArray(node)) { stack.push(...node); continue; }
          const u = node.user || node.me || node.currentUser;
          if (u && (u.user_no || u.user_id || u.userId || u.id)) {
            userId = String(u.user_no || u.user_id || u.userId || u.id);
            break;
          }
          for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v);
        }
      } catch {}
      if (!userId) {
        const el = document.querySelector('[data-user-no], [data-user_no]');
        userId = el?.getAttribute('data-user-no') || el?.getAttribute('data-user_no') || '';
      }
      return { ok: true, user_id: userId };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('band.us', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Band probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id };
}

registerSiteAuthCommands({
  site: 'band',
  domain: 'band.us',
  loginUrl: 'https://auth.band.us/login',
  columns: ['user_id'],
  quickCheck: hasBandSessionCookie,
  verify: verifyBandIdentity,
  poll: async (page) => {
    if (!await hasBandSessionCookie(page)) {
      throw new AuthRequiredError('band.us', 'Waiting for Band band_session cookie');
    }
    return verifyBandIdentity(page);
  },
});
