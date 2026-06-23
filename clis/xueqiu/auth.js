import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasXueqiuAccessToken(page) {
  const cookies = await page.getCookies({ url: 'https://xueqiu.com' });
  return cookies.some(c => c.name === 'xq_a_token' && c.value);
}

async function verifyXueqiuIdentity(page) {
  if (!await hasXueqiuAccessToken(page)) {
    throw new AuthRequiredError('xueqiu.com', 'Xueqiu xq_a_token cookie missing — anonymous');
  }
  await page.goto('https://xueqiu.com/');
  await page.wait(2);
  const probe = await page.evaluate(`(async () => {
    try {
      const res = await fetch(
        'https://stock.xueqiu.com/v5/stock/portfolio/stock/list.json?size=1&category=1&pid=-1',
        { credentials: 'include' },
      );
      if (res.status === 403) {
        return { kind: 'http', httpStatus: 403, detail: 'xueqiu stock API 403 — anti-bot / rate limit' };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      if (d?.error_code === 60201) {
        return { kind: 'auth', detail: 'xueqiu portfolio API error_code 60201 用户id无效 — anonymous' };
      }
      if (d?.error_code) {
        return { kind: 'xq-error', errorCode: d.error_code, detail: d.error_description || 'xueqiu API error' };
      }
      const uCookie = document.cookie.split('; ').find(c => c.startsWith('u='))?.split('=')[1] || '';
      const cookiesuCookie = document.cookie.split('; ').find(c => c.startsWith('cookiesu='))?.split('=')[1] || '';
      if (!uCookie || uCookie === cookiesuCookie) {
        return { kind: 'auth', detail: 'xueqiu u cookie equals cookiesu (device id) — anonymous despite portfolio API 200' };
      }
      return { ok: true, user_id: uCookie };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (probe?.kind === 'auth') throw new AuthRequiredError('xueqiu.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from xueqiu stock API: ${probe.detail || ''}`);
  if (probe?.kind === 'xq-error') throw new CommandExecutionError(`xueqiu API error_code ${probe.errorCode}: ${probe.detail}`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`xueqiu whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected xueqiu probe: ${JSON.stringify(probe)}`);
  return { user_id: String(probe.user_id) };
}

registerSiteAuthCommands({
  site: 'xueqiu',
  domain: 'xueqiu.com',
  loginUrl: 'https://xueqiu.com/',
  columns: ['user_id'],
  quickCheck: hasXueqiuAccessToken,
  verify: verifyXueqiuIdentity,
  poll: async (page) => {
    if (!await hasXueqiuAccessToken(page)) {
      throw new AuthRequiredError('xueqiu.com', 'Waiting for Xueqiu xq_a_token cookie');
    }
    return verifyXueqiuIdentity(page);
  },
});
