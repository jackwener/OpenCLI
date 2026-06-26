import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function has12306SessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://kyfw.12306.cn' });
  return cookies.some(c => c.name === 'tk' && c.value);
}

async function verify12306Identity(page) {
  if (!await has12306SessionCookie(page)) {
    throw new AuthRequiredError('12306.cn', '12306 tk auth cookie missing');
  }
  await page.goto('https://kyfw.12306.cn/otn/view/index.html');
  await page.wait(2);
  const probe = await page.evaluate(`(async () => {
    try {
      const r = await fetch('/otn/index/initMy12306Api', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (/login\\.html/.test(r.url)) {
        return { kind: 'auth', detail: '12306 initMy12306Api redirected to login' };
      }
      const t = await r.text();
      let d = null;
      try { d = JSON.parse(t); } catch {}
      if (!d || d.status === false || /未登录|登录超时|NotLogin/i.test(t)) {
        return { kind: 'auth', detail: '12306 initMy12306Api returned NotLogin' };
      }
      const userName = d.data?.user_name || d.data?.userName || d.user_name || '';
      if (!userName) {
        return { kind: 'auth', detail: '12306 initMy12306Api 200 but no user_name surface' };
      }
      return { ok: true, user_name: String(userName) };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (probe?.kind === 'auth') throw new AuthRequiredError('12306.cn', probe.detail);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`12306 whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected 12306 probe: ${JSON.stringify(probe)}`);
  return { user_name: probe.user_name };
}

registerSiteAuthCommands({
  site: '12306',
  domain: '12306.cn',
  loginUrl: 'https://kyfw.12306.cn/otn/resources/login.html',
  columns: ['user_name'],
  quickCheck: has12306SessionCookie,
  verify: verify12306Identity,
  poll: async (page) => {
    if (!await has12306SessionCookie(page)) {
      throw new AuthRequiredError('12306.cn', 'Waiting for 12306 tk auth cookie');
    }
    return verify12306Identity(page);
  },
});
