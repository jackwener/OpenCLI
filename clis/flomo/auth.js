import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasFlomoSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://flomoapp.com' });
  return cookies.some(c => c.name === 'flomo' && c.value);
}

async function verifyFlomoIdentity(page) {
  if (!await hasFlomoSessionCookie(page)) {
    throw new AuthRequiredError('flomoapp.com', 'Flomo session cookie missing');
  }
  await page.goto('https://v.flomoapp.com/mine');
  await page.wait(2);
  const probe = await page.evaluate(`
    (() => {
      if (/\\/login(\\b|$|\\?)/.test(location.href)) {
        return { kind: 'auth', detail: 'Flomo /mine redirected to /login' };
      }
      let userId = '';
      try {
        const stack = [window.__INITIAL_STATE__, window.__NUXT__, window.__PINIA__].filter(Boolean);
        const seen = new Set();
        while (stack.length) {
          const node = stack.pop();
          if (!node || typeof node !== 'object' || seen.has(node)) continue;
          seen.add(node);
          if (Array.isArray(node)) { stack.push(...node); continue; }
          const u = node.user || node.userInfo || node.currentUser;
          if (u && (u.id || u.user_id || u.uid)) { userId = String(u.id || u.user_id || u.uid); break; }
          for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v);
        }
      } catch {}
      return { ok: true, user_id: userId };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('flomoapp.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Flomo probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id };
}

registerSiteAuthCommands({
  site: 'flomo',
  domain: 'flomoapp.com',
  loginUrl: 'https://v.flomoapp.com/login',
  columns: ['user_id'],
  quickCheck: hasFlomoSessionCookie,
  verify: verifyFlomoIdentity,
  poll: async (page) => {
    if (!await hasFlomoSessionCookie(page)) {
      throw new AuthRequiredError('flomoapp.com', 'Waiting for Flomo session cookie');
    }
    return verifyFlomoIdentity(page);
  },
});
