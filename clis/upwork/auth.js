import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasUpworkSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.upwork.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('master_access_token') || names.has('XSRF-TOKEN') && names.has('user_uid');
}

async function verifyUpworkIdentity(page) {
  if (!await hasUpworkSessionCookie(page)) {
    throw new AuthRequiredError('upwork.com', 'Upwork session cookies missing');
  }
  await page.goto('https://www.upwork.com/nx/find-work/');
  await page.wait(3);
  const probe = await page.evaluate(`
    (() => {
      if (/\\/(ab|account-security\\/login|signup)\\//.test(location.pathname)) {
        return { kind: 'auth', detail: 'Upwork redirected to login flow' };
      }
      const nuxt = (typeof window !== 'undefined' && window.__NUXT__) ? window.__NUXT__ : null;
      const state = nuxt && (nuxt.state || (nuxt.data && nuxt.data[0]));
      const user = state && (state.user || (state.auth && state.auth.user));
      const profile = user && (user.profile || user);
      if (!profile || !profile.id) {
        return { kind: 'auth', detail: 'Upwork __NUXT__ has no profile id — anonymous' };
      }
      return {
        ok: true,
        user_id: String(profile.id || profile.uid || ''),
        ciphertext: String(profile.ciphertext || ''),
      };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('upwork.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Upwork probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, ciphertext: probe.ciphertext };
}

registerSiteAuthCommands({
  site: 'upwork',
  domain: 'upwork.com',
  loginUrl: 'https://www.upwork.com/ab/account-security/login',
  columns: ['user_id', 'ciphertext'],
  quickCheck: hasUpworkSessionCookie,
  verify: verifyUpworkIdentity,
  poll: async (page) => {
    if (!await hasUpworkSessionCookie(page)) {
      throw new AuthRequiredError('upwork.com', 'Waiting for Upwork session cookies');
    }
    return verifyUpworkIdentity(page);
  },
});
