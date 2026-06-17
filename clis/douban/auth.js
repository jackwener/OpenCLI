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
      const navUser = document.querySelector('.nav-user-account .bn-more, .top-nav-info a.bn-more');
      if (!navUser) {
        return { kind: 'auth', detail: 'Douban nav-user element missing — not signed in' };
      }
      const href = navUser.getAttribute('href') || '';
      const m = href.match(/people\\/(\\d+)\\/?/);
      const user_id = m ? m[1] : '';
      const name = (navUser.textContent || '').trim();
      if (!user_id) {
        return { kind: 'auth', detail: 'Douban user_id parse failed: href=' + href };
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
