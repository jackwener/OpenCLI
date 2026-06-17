import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasJdSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.jd.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('pin') || names.has('thor');
}

async function verifyJdIdentity(page) {
  if (!await hasJdSessionCookie(page)) {
    throw new AuthRequiredError('jd.com', 'JD pin / thor cookie missing');
  }
  await page.goto('https://home.jd.com/');
  await page.wait(3);
  const probe = await page.evaluate(`
    (() => {
      const pinCookie = (document.cookie.split('; ').find(c => c.startsWith('pin=')) || '').split('=')[1] || '';
      const decoded = pinCookie ? decodeURIComponent(pinCookie) : '';
      if (!decoded) {
        return { kind: 'auth', detail: 'JD pin cookie empty after decode' };
      }
      const nickEl = document.querySelector('.user-info, #aliveUserName, .name, .user-name');
      const nickname = (nickEl && nickEl.textContent && nickEl.textContent.trim()) || '';
      return { ok: true, pin: decoded, nickname };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('jd.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected JD probe: ${JSON.stringify(probe)}`);
  return { pin: probe.pin, nickname: probe.nickname };
}

registerSiteAuthCommands({
  site: 'jd',
  domain: 'jd.com',
  loginUrl: 'https://passport.jd.com/new/login.aspx',
  columns: ['pin', 'nickname'],
  quickCheck: hasJdSessionCookie,
  verify: verifyJdIdentity,
  poll: async (page) => {
    if (!await hasJdSessionCookie(page)) {
      throw new AuthRequiredError('jd.com', 'Waiting for JD pin / thor cookie');
    }
    return verifyJdIdentity(page);
  },
});
