import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasXhsSessionCookies(page) {
  const cookies = await page.getCookies({ url: 'https://creator.xiaohongshu.com' });
  const names = new Set(cookies.map(cookie => cookie.name));
  return names.has('web_session');
}

async function verifyXhsIdentity(page) {
  await page.goto('https://creator.xiaohongshu.com/new/home');
  const payload = await page.evaluate(`
    async () => {
      try {
        const resp = await fetch('/api/galaxy/creator/home/personal_info', { credentials: 'include' });
        const text = await resp.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch {}
        return [resp.ok, resp.status, parsed, text.slice(0, 200)];
      } catch (error) {
        return [false, 0, null, String(error && error.message || error)];
      }
    }
  `);
  const [ok, status, parsed, preview] = Array.isArray(payload) ? payload : [];
  if (!ok) {
    const detail = parsed?.msg ?? preview ?? `HTTP ${status ?? ''}`;
    throw new AuthRequiredError('creator.xiaohongshu.com', `Xiaohongshu creator profile requires login: ${detail}`);
  }
  const data = parsed?.data;
  if (!data) {
    throw new CommandExecutionError('Xiaohongshu creator profile returned malformed personal_info payload');
  }
  return {
    username: data.name ?? '',
    followers: data.fans_count ?? 0,
  };
}

registerSiteAuthCommands({
  site: 'xiaohongshu',
  domain: 'creator.xiaohongshu.com',
  loginUrl: 'https://creator.xiaohongshu.com/',
  columns: ['username', 'followers'],
  quickCheck: hasXhsSessionCookies,
  verify: verifyXhsIdentity,
  poll: async (page) => {
    if (!await hasXhsSessionCookies(page)) {
      throw new AuthRequiredError('creator.xiaohongshu.com', 'Waiting for Xiaohongshu session cookies');
    }
    return verifyXhsIdentity(page);
  },
});
