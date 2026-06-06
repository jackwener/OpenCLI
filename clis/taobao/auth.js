import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasTaobaoSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.taobao.com' });
  return cookies.some(c => c.name === 'tracknick' && c.value);
}

async function verifyTaobaoIdentity(page) {
  if (!await hasTaobaoSessionCookie(page)) {
    throw new AuthRequiredError('taobao.com', 'Taobao tracknick cookie missing — anonymous');
  }
  await page.goto('https://i.taobao.com/my_itaobao');
  await page.wait(2);
  const finalUrl = await page.evaluate(`location.href`);
  if (/login\.taobao\.com\/member\/login/.test(String(finalUrl || ''))) {
    throw new AuthRequiredError('taobao.com', `Taobao my_itaobao redirected to login: ${finalUrl}`);
  }
  const cookies = await page.getCookies({ url: 'https://www.taobao.com' });
  const tracknick = cookies.find(c => c.name === 'tracknick')?.value || '';
  if (!tracknick) {
    throw new AuthRequiredError('taobao.com', 'Taobao tracknick cookie absent after navigation');
  }
  const domInfo = await page.evaluate(`
    (() => {
      const nick = (document.querySelector('.user-nick, .site-nav-user, .user-name')?.innerText || '').trim();
      const html = document.body?.innerHTML || '';
      const userIdMatch = html.match(/userId[\"'\\s:=]+(\\d+)/i);
      return { nickname: nick, user_id: userIdMatch?.[1] || '' };
    })()
  `);
  let decodedTracknick = '';
  try {
    decodedTracknick = JSON.parse('"' + tracknick.replace(/\\/g, '\\\\') + '"');
  } catch {
    decodedTracknick = tracknick;
  }
  const nickname = domInfo.nickname || decodedTracknick;
  if (!domInfo.user_id) {
    throw new CommandExecutionError('Taobao my_itaobao rendered but no user_id extractable — stale cookie2 or layout drift');
  }
  return { user_id: String(domInfo.user_id), nickname: String(nickname) };
}

registerSiteAuthCommands({
  site: 'taobao',
  domain: 'taobao.com',
  loginUrl: 'https://login.taobao.com/member/login.jhtml',
  columns: ['user_id', 'nickname'],
  quickCheck: hasTaobaoSessionCookie,
  verify: verifyTaobaoIdentity,
  poll: async (page) => {
    if (!await hasTaobaoSessionCookie(page)) {
      throw new AuthRequiredError('taobao.com', 'Waiting for Taobao tracknick cookie');
    }
    return verifyTaobaoIdentity(page);
  },
});
