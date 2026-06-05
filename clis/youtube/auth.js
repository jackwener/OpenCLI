import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasGoogleSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.youtube.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('SID') || names.has('SAPISID') || names.has('__Secure-1PSID');
}

async function verifyYoutubeIdentity(page) {
  if (!await hasGoogleSessionCookie(page)) {
    throw new AuthRequiredError('www.youtube.com', 'Google session cookies missing');
  }
  await page.goto('https://www.youtube.com/');
  await page.wait(3);
  const probe = await page.evaluate(`
    (() => {
      const cfg = (typeof window !== 'undefined' && window.ytcfg && typeof window.ytcfg.get === 'function')
        ? window.ytcfg.get('INNERTUBE_CONTEXT')
        : null;
      const user = cfg && cfg.client && cfg.client.userIdentity;
      const loggedIn = !!(cfg && cfg.user && cfg.user.lockedSafetyMode === false);
      const account = document.querySelector('button#avatar-btn, ytd-topbar-menu-button-renderer #avatar-btn');
      if (!account) {
        return { kind: 'auth', detail: 'YouTube avatar button missing — not signed in' };
      }
      const name = (cfg && cfg.user && cfg.user.identityName) || (account.getAttribute('aria-label') || '').replace(/^Account menu.*/i, '').trim();
      if (!name) {
        return { kind: 'render-error', detail: 'YouTube avatar present but identity name not extractable — layout drift' };
      }
      return { ok: true, name };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('www.youtube.com', probe.detail);
  if (probe?.kind === 'render-error') throw new CommandExecutionError(probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected YouTube probe: ${JSON.stringify(probe)}`);
  return { name: probe.name };
}

registerSiteAuthCommands({
  site: 'youtube',
  domain: 'www.youtube.com',
  loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F',
  columns: ['name'],
  verify: verifyYoutubeIdentity,
  poll: async (page) => {
    if (!await hasGoogleSessionCookie(page)) {
      throw new AuthRequiredError('www.youtube.com', 'Waiting for Google session cookies');
    }
    return verifyYoutubeIdentity(page);
  },
});
