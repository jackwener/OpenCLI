import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasKeSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.ke.com' });
  return cookies.some(c => c.name === 'lianjia_token' && c.value);
}

async function verifyKeIdentity(page) {
  if (!await hasKeSessionCookie(page)) {
    throw new AuthRequiredError('ke.com', 'Ke lianjia_token cookie missing — anonymous');
  }
  await page.goto('https://www.ke.com/');
  await page.wait(2);
  const probe = await page.evaluate(`
    (() => {
      const loginBtn = document.querySelector('.btn-login, a[class*=actLoginBtn], .login-btn');
      if (loginBtn && /登录|登陆/.test(loginBtn.innerText || '')) {
        return { kind: 'auth', detail: 'Ke shows 登录 button — anonymous session' };
      }
      // 2026-08 贝壳新版 SSR：用户名在 .typeShowUser（脱敏手机号如 15****93），
      // 旧锚点 .userNick/.user-name/.myInfo 已下线，故把 .typeShowUser 提到最前。
      const el = document.querySelector('.typeShowUser a span, .typeShowUser a, .userNick, .user-name, .myInfo a, [class*=userNick]');
      const username = (el?.innerText || '').trim();
      if (!username) {
        return { kind: 'auth', detail: 'Ke no user-name DOM anchor — anonymous or SSR failed' };
      }
      return { ok: true, username };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('ke.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Ke probe: ${JSON.stringify(probe)}`);
  return { username: probe.username };
}

registerSiteAuthCommands({
  site: 'ke',
  domain: 'ke.com',
  loginUrl: 'https://clogin.ke.com/login/?service=https%3A%2F%2Fwww.ke.com',
  columns: ['username'],
  verify: verifyKeIdentity,
  poll: async (page) => {
    if (!await hasKeSessionCookie(page)) {
      throw new AuthRequiredError('ke.com', 'Waiting for Ke lianjia_token cookie');
    }
    return verifyKeIdentity(page);
  },
});
