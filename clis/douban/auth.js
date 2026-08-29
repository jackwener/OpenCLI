import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasDoubanSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.douban.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('dbcl2') || names.has('ck');
}

function parseDoubanUserId(value) {
  const text = String(value ?? '');
  return text.match(/(?:^|\/)people\/(\d+)\/?/)?.[1]
    || text.match(/^"?(\d+):/)?.[1]
    || '';
}

async function verifyDoubanIdentity(page) {
  const cookies = await page.getCookies({ url: 'https://www.douban.com' });
  const names = new Set(cookies.map(c => c.name));
  if (!names.has('dbcl2') && !names.has('ck')) {
    throw new AuthRequiredError('douban.com', 'Douban dbcl2 / ck cookies missing');
  }
  const cookieUid = parseDoubanUserId(cookies.find(c => c.name === 'dbcl2')?.value);
  await page.goto('https://www.douban.com/mine/');
  await page.wait(2);
  const probe = await page.evaluate(`
    (() => {
      const parseUid = (value) => String(value || '').match(/(?:^|\\/)people\\/(\\d+)\\/?/)?.[1] || '';
      const currentUrl = new URL(window.location.href);
      if (currentUrl.hostname === 'accounts.douban.com' || currentUrl.pathname.startsWith('/passport/')) {
        return { kind: 'auth', detail: 'Douban /mine redirected to the login flow' };
      }
      const navUser = document.querySelector('.nav-user-account .bn-more, .top-nav-info a.bn-more');
      const navHref = navUser?.getAttribute('href') || navUser?.href || '';
      const user_id = parseUid(window.location.href) || parseUid(navHref);
      const name = (navUser?.textContent || document.querySelector('.info h1, h1')?.textContent || '').trim();
      return user_id
        ? { ok: true, user_id, name }
        : { kind: 'unknown', detail: 'Douban user_id parse failed: href=' + navHref + ' location=' + window.location.href };
    })()
  `);
  if (probe?.kind === 'unknown' && cookieUid) {
    return { user_id: cookieUid, name: '' };
  }
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
