import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasGoogleSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.youtube.com' });
  const names = new Set(cookies.map(c => c.name));
  // auth status is a quick cookie-presence hint; whoami verifies YouTube's page state below.
  return [
    'SID',
    'SAPISID',
    '__Secure-1PSID',
    '__Secure-3PSID',
    '__Secure-1PAPISID',
    '__Secure-3PAPISID',
    'LOGIN_INFO',
  ].some(name => names.has(name));
}

async function verifyYoutubeIdentity(page) {
  await page.goto('https://www.youtube.com/');
  await page.wait(3);
  const probe = await page.evaluate(`
    (() => {
      const cfg = (typeof window !== 'undefined' && window.ytcfg && typeof window.ytcfg.get === 'function') ? window.ytcfg : null;
      // Prefer YouTube's explicit login flag. Use the avatar only when the flag is unavailable.
      const loginFlag = cfg && cfg.get('LOGGED_IN');
      const loggedIn = typeof loginFlag === 'boolean' ? loginFlag : !!document.querySelector('#avatar-btn');
      if (!loggedIn) {
        return { kind: 'auth', detail: 'YouTube page does not report an authenticated session' };
      }
      // Name is best-effort: YouTube's masthead avatar exposes a generic
      // localized menu label, not the account name. Leave it empty when the
      // page does not expose an identity name.
      let name = '';
      try { const ctx = cfg && cfg.get('INNERTUBE_CONTEXT'); name = (ctx && ctx.user && ctx.user.identityName) || ''; } catch {}
      return { ok: true, name: String(name || '') };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('www.youtube.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected YouTube probe: ${JSON.stringify(probe)}`);
  return { name: probe.name };
}

registerSiteAuthCommands({
  site: 'youtube',
  domain: 'www.youtube.com',
  loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
  columns: ['name'],
  quickCheck: hasGoogleSessionCookie,
  verify: verifyYoutubeIdentity,
  poll: async (page) => verifyYoutubeIdentity(page),
});
