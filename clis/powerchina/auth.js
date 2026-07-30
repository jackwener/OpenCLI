import { AuthRequiredError, CommandExecutionError } from '@woosau/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasPowerchinaSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://zhaopin.powerchina.cn' });
  // JSESSIONID / SESSION are issued for anonymous Java sessions too; gate only on
  // the auth-token cookies so the login poll doesn't navigate away mid-login.
  return cookies.some(c => /^(Admin-Token|access_token)$/i.test(c.name) && c.value);
}

async function verifyPowerchinaIdentity(page) {
  if (!await hasPowerchinaSessionCookie(page)) {
    throw new AuthRequiredError('powerchina.cn', 'Powerchina session cookies missing — anonymous');
  }
  await page.goto('https://zhaopin.powerchina.cn/index');
  await page.wait(3);
  const probe = await page.evaluate(`
    (() => {
      if (/\\/login(\\b|$|\\?)/.test(location.pathname)) {
        return { kind: 'auth', detail: 'Powerchina redirected to /login — anonymous' };
      }
      const bodyText = document.body?.innerText || '';
      if (/欢迎登录.*【登录】|请登录|您未登录/.test(bodyText)) {
        return { kind: 'auth', detail: 'Powerchina shows 欢迎登录 prompt — anonymous' };
      }
      const el = document.querySelector('.user-info, .userName, .personalCenter [class*=name]');
      const userName = (el?.innerText || '').trim();
      if (!userName) {
        return { kind: 'auth', detail: 'Powerchina no user name DOM — anonymous or layout changed' };
      }
      return { ok: true, name: userName };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('powerchina.cn', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Powerchina probe: ${JSON.stringify(probe)}`);
  return { name: probe.name };
}

registerSiteAuthCommands({
  site: 'powerchina',
  domain: 'powerchina.cn',
  loginUrl: 'https://zhaopin.powerchina.cn/login',
  columns: ['name'],
  quickCheck: hasPowerchinaSessionCookie,
  verify: verifyPowerchinaIdentity,
  poll: async (page) => {
    if (!await hasPowerchinaSessionCookie(page)) {
      throw new AuthRequiredError('powerchina.cn', 'Waiting for Powerchina session cookies');
    }
    return verifyPowerchinaIdentity(page);
  },
});
