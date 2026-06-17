import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasHupuUserCookie(page) {
  const cookies = await page.getCookies({ url: 'https://my.hupu.com' });
  return cookies.some(c => c.name === 'u' && c.value);
}

async function verifyHupuIdentity(page) {
  if (!await hasHupuUserCookie(page)) {
    throw new AuthRequiredError('hupu.com', 'Hupu u cookie missing — anonymous');
  }
  await page.goto('https://my.hupu.com/');
  await page.wait(2);
  const probe = await page.evaluate(`
    (() => {
      if (/passport\\.hupu\\.com\\/.*login/.test(location.href)) {
        return { kind: 'auth', detail: 'Hupu my page redirected to passport login' };
      }
      const uCookie = (document.cookie.split('; ').find(c => c.startsWith('u=')) || '').split('=')[1] || '';
      const el = document.querySelector('.user-name, .username, .nick, [class*="userName"]');
      const username = (el?.innerText || '').trim();
      if (!uCookie) {
        return { kind: 'auth', detail: 'Hupu my page rendered but u cookie absent — stale session' };
      }
      return { ok: true, user_id: uCookie, username };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('hupu.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Hupu probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, username: probe.username };
}

registerSiteAuthCommands({
  site: 'hupu',
  domain: 'hupu.com',
  loginUrl: 'https://passport.hupu.com/pc/login',
  columns: ['user_id', 'username'],
  quickCheck: hasHupuUserCookie,
  verify: verifyHupuIdentity,
  poll: async (page) => {
    if (!await hasHupuUserCookie(page)) {
      throw new AuthRequiredError('hupu.com', 'Waiting for Hupu u cookie');
    }
    return verifyHupuIdentity(page);
  },
});
