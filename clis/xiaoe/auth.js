import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasXiaoeAdminCookie(page) {
  const cookies = await page.getCookies({ url: 'https://admin.xiaoe-tech.com' });
  return cookies.some(c => (c.name === 'XIAOEID' || c.name === 'b_user_token') && c.value);
}

async function verifyXiaoeIdentity(page) {
  if (!await hasXiaoeAdminCookie(page)) {
    throw new AuthRequiredError('xiaoe-tech.com', 'Xiaoe XIAOEID/b_user_token cookie missing — anonymous');
  }
  await page.goto('https://admin.xiaoe-tech.com/t/account/muti_index');
  await page.wait(3);
  const finalUrl = await page.evaluate(`location.href`);
  if (/login|signin|#\/wx$/.test(String(finalUrl || ''))) {
    throw new AuthRequiredError('xiaoe-tech.com', `Xiaoe admin page redirected to login: ${finalUrl}`);
  }
  const cookies = await page.getCookies({ url: 'https://admin.xiaoe-tech.com' });
  const xiaoeId = cookies.find(c => c.name === 'XIAOEID')?.value || '';
  const unionId = cookies.find(c => c.name === 'unionid')?.value || '';
  const probe = await page.evaluate(`
    (() => {
      const bodyText = document.body?.innerText || '';
      if (/微信扫码登录|手机号登录|登录小鹅通/.test(bodyText)) {
        return { isLoginPage: true };
      }
      const nick = document.querySelector('.user-name, .nickname, [class*="userName"], [class*="user-info"]')?.innerText?.trim() || '';
      return { isLoginPage: false, domNick: nick };
    })()
  `);
  if (probe.isLoginPage) {
    throw new AuthRequiredError('xiaoe-tech.com', 'Xiaoe admin page showed login UI — anonymous session');
  }
  const userId = xiaoeId || unionId;
  if (!userId) {
    throw new CommandExecutionError('Xiaoe admin page rendered but no user_id cookie extractable — stale session');
  }
  return { user_id: String(userId), nickname: String(probe.domNick || '') };
}

registerSiteAuthCommands({
  site: 'xiaoe',
  domain: 'xiaoe-tech.com',
  loginUrl: 'https://admin.xiaoe-tech.com/',
  columns: ['user_id', 'nickname'],
  quickCheck: hasXiaoeAdminCookie,
  verify: verifyXiaoeIdentity,
  poll: async (page) => {
    if (!await hasXiaoeAdminCookie(page)) {
      throw new AuthRequiredError('xiaoe-tech.com', 'Waiting for Xiaoe XIAOEID/b_user_token cookie');
    }
    return verifyXiaoeIdentity(page);
  },
});
