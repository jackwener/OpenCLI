import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasJianyuUserCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.jianyu360.cn' });
  return cookies.some(c => c.name === 'userid_secure' && c.value);
}

async function verifyJianyuIdentity(page) {
  if (!await hasJianyuUserCookie(page)) {
    throw new AuthRequiredError('jianyu360.cn', 'Jianyu userid_secure cookie missing — anonymous');
  }
  await page.goto('https://www.jianyu360.cn/');
  await page.wait(2);
  const probe = await page.evaluate(`(async () => {
    try {
      const r = await fetch('/swordfish/frontPage/customer/sess/index', { credentials: 'include' });
      const text = await r.text();
      if (/<title>\\s*登录\\s*[-—]\\s*剑鱼标讯/.test(text)) {
        return { kind: 'auth', detail: 'Jianyu protected page returned login page — anonymous' };
      }
      const userIdMeta = text.match(/<meta[^>]+name=[\"'](?:user-id|userId)[\"'][^>]+content=[\"']([^\"']+)[\"']/)?.[1] || '';
      const userScript = text.match(/window\\.__USER__\\s*=\\s*(\\{[^}]+\\})/)?.[1] || '';
      let userId = userIdMeta;
      let name = '';
      if (userScript) {
        try {
          const u = JSON.parse(userScript);
          userId = userId || String(u.id || u.userId || '');
          name = String(u.name || u.realName || u.nickName || '');
        } catch {}
      }
      const cookieUid = (document.cookie.split('; ').find(c => c.startsWith('userid_secure=')) || '').split('=')[1] || '';
      userId = userId || cookieUid;
      if (!userId && !name) {
        return { kind: 'auth', detail: 'Jianyu protected page 200 but no user identity surface' };
      }
      return { ok: true, user_id: userId, name };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (probe?.kind === 'auth') throw new AuthRequiredError('jianyu360.cn', probe.detail);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Jianyu whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Jianyu probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, name: probe.name };
}

registerSiteAuthCommands({
  site: 'jianyu',
  domain: 'jianyu360.cn',
  loginUrl: 'https://www.jianyu360.cn/',
  columns: ['user_id', 'name'],
  quickCheck: hasJianyuUserCookie,
  verify: verifyJianyuIdentity,
  poll: async (page) => {
    if (!await hasJianyuUserCookie(page)) {
      throw new AuthRequiredError('jianyu360.cn', 'Waiting for Jianyu userid_secure cookie');
    }
    return verifyJianyuIdentity(page);
  },
});
