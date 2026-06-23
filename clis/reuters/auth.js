import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function verifyReutersIdentity(page) {
  await page.goto('https://www.reuters.com/');
  await page.wait(2);
  const probe = await page.evaluate(`
    (() => {
      try {
        const subStateRaw = localStorage.getItem('rcom-subscription-state');
        let subState = null;
        if (subStateRaw) { try { subState = JSON.parse(subStateRaw); } catch {} }
        if (!subState || subState.isLoggedIn !== true) {
          return { kind: 'auth', detail: 'Reuters rcom-subscription-state.isLoggedIn is not true — anonymous' };
        }
        let oidcKey = null;
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('oidc.user:')) { oidcKey = k; break; }
        }
        let cuid = '';
        if (oidcKey) {
          try {
            const u = JSON.parse(localStorage.getItem(oidcKey) || '{}');
            cuid = String(u?.profile?.cuid || u?.profile?.sub || '');
          } catch {}
        }
        if (!cuid) {
          const ajs = localStorage.getItem('ajs_user_id');
          if (ajs && ajs !== 'null') cuid = ajs;
        }
        if (!cuid) {
          return { kind: 'auth', detail: 'Reuters logged-in but cuid missing — session shape drifted' };
        }
        return { ok: true, user_id: cuid, subscribed: Boolean(subState.isSubscribed) };
      } catch (e) {
        return { kind: 'exception', detail: String(e && e.message || e) };
      }
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('reuters.com', probe.detail);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Reuters whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Reuters probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, subscribed: probe.subscribed };
}

registerSiteAuthCommands({
  site: 'reuters',
  domain: 'reuters.com',
  loginUrl: 'https://www.reuters.com/account/sign-in/',
  columns: ['user_id', 'subscribed'],
  verify: verifyReutersIdentity,
  // No-navigation poll: check localStorage on the current page so login-flow
  // polling doesn't bounce the user off the sign-in page every interval.
  poll: async (page) => {
    const loggedIn = await page.evaluate(`(() => {
      try {
        const raw = localStorage.getItem('rcom-subscription-state');
        return raw ? JSON.parse(raw).isLoggedIn === true : false;
      } catch { return false; }
    })()`);
    if (!loggedIn) {
      throw new AuthRequiredError('reuters.com', 'Waiting for Reuters login');
    }
    return verifyReutersIdentity(page);
  },
});
