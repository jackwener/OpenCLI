import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasWereadSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://weread.qq.com' });
  return cookies.some(c => c.name === 'wr_vid' && c.value);
}

async function verifyWereadIdentity(page) {
  if (!await hasWereadSessionCookie(page)) {
    throw new AuthRequiredError('weread.qq.com', 'WeRead wr_vid cookie missing');
  }
  await page.goto('https://weread.qq.com/');
  await page.wait(2);
  const result = await page.evaluate(`(async () => {
    try {
      const wrVid = (document.cookie.split('; ').find(c => c.startsWith('wr_vid=')) || '').split('=')[1] || '';
      if (!wrVid) {
        return { kind: 'auth', detail: 'WeRead wr_vid cookie absent in document.cookie' };
      }
      const res = await fetch('/web/user', { credentials: 'include', headers: { 'Accept': 'application/json' } });
      if (res.status === 401 || res.status === 403) {
        return { kind: 'auth', detail: 'WeRead /web/user HTTP ' + res.status };
      }
      if (!res.ok) return { kind: 'http', httpStatus: res.status };
      const d = await res.json();
      if (d && d.errCode && d.errCode !== 0) {
        return { kind: 'auth', detail: 'WeRead /web/user errCode=' + d.errCode };
      }
      return {
        ok: true,
        user_id: String(d.userVid || wrVid),
        name: String(d.name || d.nickName || ''),
      };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (result?.kind === 'auth') throw new AuthRequiredError('weread.qq.com', result.detail);
  if (result?.kind === 'http') throw new CommandExecutionError(`HTTP ${result.httpStatus} from /web/user`);
  if (result?.kind === 'exception') throw new CommandExecutionError(`WeRead whoami failed: ${result.detail}`);
  if (!result?.ok) throw new CommandExecutionError(`Unexpected WeRead probe: ${JSON.stringify(result)}`);
  return { user_id: result.user_id, name: result.name };
}

registerSiteAuthCommands({
  site: 'weread',
  domain: 'weread.qq.com',
  loginUrl: 'https://weread.qq.com/',
  columns: ['user_id', 'name'],
  quickCheck: hasWereadSessionCookie,
  verify: verifyWereadIdentity,
  poll: async (page) => {
    if (!await hasWereadSessionCookie(page)) {
      throw new AuthRequiredError('weread.qq.com', 'Waiting for WeRead wr_vid cookie');
    }
    return verifyWereadIdentity(page);
  },
});
