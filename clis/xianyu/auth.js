import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasXianyuIdentityCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.goofish.com' });
  return cookies.some(c => (c.name === 'unb' || c.name === 'tracknick') && c.value);
}

async function verifyXianyuIdentity(page) {
  if (!await hasXianyuIdentityCookie(page)) {
    throw new AuthRequiredError('goofish.com', 'Xianyu unb/tracknick cookie missing — anonymous');
  }
  await page.goto('https://www.goofish.com/personal');
  await page.wait(2);
  const finalUrl = await page.evaluate(`location.href`);
  if (/passport\.(taobao|goofish)\.com\/(member\/login|login)/.test(String(finalUrl || ''))) {
    throw new AuthRequiredError('goofish.com', `Xianyu /personal redirected to login: ${finalUrl}`);
  }
  const cookies = await page.getCookies({ url: 'https://www.goofish.com' });
  const tracknick = cookies.find(c => c.name === 'tracknick')?.value || '';
  const unb = cookies.find(c => c.name === 'unb')?.value || '';
  const probe = await page.evaluate(`
    (() => {
      const bodyText = document.body?.innerText || '';
      const requiresAuth = /请先登录|登录后/.test(bodyText);
      const blocked = /验证码|安全验证|异常访问/.test(bodyText);
      const nick = document.querySelector('.user-name, .user-nick, .nick, [class*="nickname"]')?.innerText?.trim() || '';
      const html = document.body?.innerHTML || '';
      const userIdMatch = html.match(/['"]?userId['"]?\\s*[:=]\\s*['"]?(\\d+)/i);
      return { requiresAuth, blocked, domNick: nick, domUserId: userIdMatch?.[1] || '' };
    })()
  `);
  if (probe.blocked) {
    throw new AuthRequiredError('goofish.com', 'Xianyu blocked by verification / risk control');
  }
  if (probe.requiresAuth) {
    throw new AuthRequiredError('goofish.com', 'Xianyu /personal shows login prompt — anonymous');
  }
  const userId = probe.domUserId || unb;
  let decodedTracknick = '';
  if (tracknick) {
    try {
      decodedTracknick = JSON.parse('"' + tracknick.replace(/\\/g, '\\\\') + '"');
    } catch {
      decodedTracknick = tracknick;
    }
  }
  const nickname = probe.domNick || decodedTracknick;
  if (!userId && !nickname) {
    throw new CommandExecutionError('Xianyu /personal rendered but no user identity extractable — stale unb or layout drift');
  }
  return { user_id: String(userId), nickname: String(nickname) };
}

registerSiteAuthCommands({
  site: 'xianyu',
  domain: 'goofish.com',
  loginUrl: 'https://www.goofish.com/login',
  columns: ['user_id', 'nickname'],
  quickCheck: hasXianyuIdentityCookie,
  verify: verifyXianyuIdentity,
  poll: async (page) => {
    if (!await hasXianyuIdentityCookie(page)) {
      throw new AuthRequiredError('goofish.com', 'Waiting for Xianyu unb/tracknick cookie');
    }
    return verifyXianyuIdentity(page);
  },
});
