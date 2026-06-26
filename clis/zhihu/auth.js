import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasZhihuAuthCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.zhihu.com' });
  return cookies.some(c => c.name === 'z_c0' && c.value);
}

async function verifyZhihuIdentity(page) {
  if (!await hasZhihuAuthCookie(page)) {
    throw new AuthRequiredError('www.zhihu.com', 'Zhihu z_c0 cookie missing — anonymous');
  }
  await page.goto('https://www.zhihu.com/');
  await page.wait(2);
  const data = await page.evaluate(`
    (async () => {
      try {
        const r = await fetch('https://www.zhihu.com/api/v4/me?include=url_token', { credentials: 'include' });
        if (!r.ok) return { __httpError: r.status };
        return await r.json();
      } catch (e) {
        return { __exception: String(e && e.message || e) };
      }
    })()
  `);
  if (data?.__exception) {
    throw new CommandExecutionError(`Zhihu whoami failed: ${data.__exception}`);
  }
  if (!data || data.__httpError) {
    const status = data?.__httpError;
    if (status === 401 || status === 403) {
      throw new AuthRequiredError('www.zhihu.com', `Zhihu /api/v4/me returned HTTP ${status} — anonymous`);
    }
    throw new CommandExecutionError(`Zhihu identity probe failed (HTTP ${status ?? 'unknown'})`);
  }
  if (!data.url_token) {
    throw new AuthRequiredError('www.zhihu.com', 'Zhihu /api/v4/me returned no url_token — anonymous session');
  }
  return {
    url_token: String(data.url_token),
    name: String(data.name ?? ''),
    uid: String(data.uid ?? data.id ?? ''),
  };
}

registerSiteAuthCommands({
  site: 'zhihu',
  domain: 'www.zhihu.com',
  loginUrl: 'https://www.zhihu.com/signin',
  columns: ['url_token', 'name', 'uid'],
  quickCheck: hasZhihuAuthCookie,
  verify: verifyZhihuIdentity,
  poll: async (page) => {
    if (!await hasZhihuAuthCookie(page)) {
      throw new AuthRequiredError('www.zhihu.com', 'Waiting for Zhihu z_c0 cookie');
    }
    return verifyZhihuIdentity(page);
  },
});
