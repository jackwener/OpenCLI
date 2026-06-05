import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasCoupangSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.coupang.com' });
  return cookies.some(c => /^(AID|MEMBER_ID|LMSESSIONID)$/.test(c.name) && c.value);
}

async function verifyCoupangIdentity(page) {
  if (!await hasCoupangSessionCookie(page)) {
    throw new AuthRequiredError('coupang.com', 'Coupang session cookies (AID/MEMBER_ID/LMSESSIONID) missing');
  }
  await page.goto('https://www.coupang.com/np/mypage');
  await page.wait(3);
  const probe = await page.evaluate(`
    (() => {
      if (/login\\.coupang\\.com\\/login/.test(location.href)) {
        return { kind: 'auth', detail: 'Coupang mypage redirected to login — anonymous' };
      }
      if (/Access Denied/i.test(document.title)) {
        return { kind: 'auth', detail: 'Coupang Access Denied — anti-bot or non-KR IP' };
      }
      const el = document.querySelector('.my-nickname, .member-name, .mp-user-info-name, [class*=memberName]');
      const name = (el?.textContent || '').trim();
      if (!name) {
        return { kind: 'auth', detail: 'Coupang mypage 200 but no member-name surface' };
      }
      return { ok: true, name };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('coupang.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Coupang probe: ${JSON.stringify(probe)}`);
  return { name: probe.name };
}

registerSiteAuthCommands({
  site: 'coupang',
  domain: 'coupang.com',
  loginUrl: 'https://login.coupang.com/login/login.pang',
  columns: ['name'],
  verify: verifyCoupangIdentity,
  poll: async (page) => {
    if (!await hasCoupangSessionCookie(page)) {
      throw new AuthRequiredError('coupang.com', 'Waiting for Coupang session cookies');
    }
    return verifyCoupangIdentity(page);
  },
});
