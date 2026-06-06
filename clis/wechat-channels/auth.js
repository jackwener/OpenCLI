import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasWechatChannelsSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://channels.weixin.qq.com' });
  return cookies.some(c => c.name === 'sessionid' && c.value);
}

async function verifyWechatChannelsIdentity(page) {
  if (!await hasWechatChannelsSessionCookie(page)) {
    throw new AuthRequiredError('channels.weixin.qq.com', 'WeChat Channels sessionid cookie missing');
  }
  await page.goto('https://channels.weixin.qq.com/platform');
  await page.wait(2);
  const probe = await page.evaluate(`(async () => {
    try {
      if (/login\\.html/.test(location.href)) {
        return { kind: 'auth', detail: 'WeChat Channels platform redirected to login.html' };
      }
      const r = await fetch('/cgi-bin/mmfinderassistant-bin/auth/auth_data', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!r.ok) return { kind: 'http', httpStatus: r.status };
      const d = await r.json();
      if (!d || d.base_resp?.ret !== 0) {
        return { kind: 'auth', detail: 'WeChat Channels auth_data base_resp.ret=' + String(d?.base_resp?.ret) };
      }
      const fu = d.data?.finder_user || d.finder_user || {};
      const userId = String(fu.uniq_id || fu.username || '');
      const name = String(fu.nickname || fu.name || '');
      if (!userId && !name) {
        return { kind: 'auth', detail: 'WeChat Channels auth_data 200 but finder_user empty' };
      }
      return { ok: true, user_id: userId, name };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (probe?.kind === 'auth') throw new AuthRequiredError('channels.weixin.qq.com', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from auth_data`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`WeChat Channels whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected WeChat Channels probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, name: probe.name };
}

registerSiteAuthCommands({
  site: 'wechat-channels',
  domain: 'channels.weixin.qq.com',
  loginUrl: 'https://channels.weixin.qq.com/login.html?from=assistant',
  columns: ['user_id', 'name'],
  quickCheck: hasWechatChannelsSessionCookie,
  verify: verifyWechatChannelsIdentity,
  poll: async (page) => {
    if (!await hasWechatChannelsSessionCookie(page)) {
      throw new AuthRequiredError('channels.weixin.qq.com', 'Waiting for WeChat Channels sessionid cookie');
    }
    return verifyWechatChannelsIdentity(page);
  },
});
