import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasDoubanSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.douban.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('dbcl2') || names.has('ck');
}

async function verifyDoubanIdentity(page) {
  if (!await hasDoubanSessionCookie(page)) {
    throw new AuthRequiredError('douban.com', 'Douban dbcl2 / ck cookies missing');
  }
  await page.goto('https://www.douban.com/');
  await page.wait(2);
  const probe = await page.evaluate(`
    (() => {
      // 2026-08 豆瓣新版首页：.bn-more href 从 /people/<id>/ 改为 /passport/setting/，
      // 登录判定改为「账号元素存在 + ck cookie」，user_id 从 /people 链接或 dbcl2 cookie 兜底（可取空）。
      const navUser = document.querySelector('.nav-user-account .bn-more, .top-nav-info a.bn-more, .nav-user-account a');
      if (!navUser) {
        return { kind: 'auth', detail: 'Douban nav-user element missing — not signed in' };
      }
      const name = (navUser.textContent || '').trim();
      // user_id 来源 1：任意 /people/<id>/ 链接（旧版首页结构）
      const peopleLink = document.querySelector('a[href*="/people/"]');
      const href = peopleLink ? (peopleLink.getAttribute('href') || '') : (navUser.getAttribute('href') || '');
      let m = href.match(/people\\/(\\d+)\\/?/);
      let user_id = m ? m[1] : '';
      // user_id 来源 2：dbcl2 cookie，格式 "<uid>:<token>"（HttpOnly 时 JS 取不到，静默跳过）
      if (!user_id) {
        const db = (document.cookie.match(/dbcl2="?(\\d+):/) || []);
        if (db[1]) user_id = db[1];
      }
      const ck = (document.cookie.match(/(?:^|;\\s*)ck=([^;]+)/) || [])[1] || '';
      if (!ck && !user_id) {
        return { kind: 'auth', detail: 'Douban no ck cookie and no user_id — not signed in' };
      }
      return { ok: true, user_id, name };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('douban.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Douban probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, name: probe.name };
}

registerSiteAuthCommands({
  site: 'douban',
  domain: 'douban.com',
  loginUrl: 'https://accounts.douban.com/passport/login',
  columns: ['user_id', 'name'],
  quickCheck: hasDoubanSessionCookie,
  verify: verifyDoubanIdentity,
  poll: async (page) => {
    if (!await hasDoubanSessionCookie(page)) {
      throw new AuthRequiredError('douban.com', 'Waiting for Douban dbcl2 / ck cookies');
    }
    return verifyDoubanIdentity(page);
  },
});
