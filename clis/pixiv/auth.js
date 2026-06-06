import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasPixivSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.pixiv.net' });
  // Anonymous PHPSESSID is a bare hash; logged-in form is `<userId>_<hash>`.
  // Require the numeric uid prefix so the login poll doesn't navigate away
  // from accounts.pixiv.net while the user is still signing in.
  return cookies.some(c => c.name === 'PHPSESSID' && /^\d+_/.test(c.value || ''));
}

async function verifyPixivIdentity(page) {
  if (!await hasPixivSessionCookie(page)) {
    throw new AuthRequiredError('pixiv.net', 'Pixiv PHPSESSID cookie missing');
  }
  await page.goto('https://www.pixiv.net/');
  await page.wait(2);
  const probe = await page.evaluate(`(async () => {
    try {
      const meta = document.querySelector('meta[name="global-data"]')?.getAttribute('content') || '';
      let userData = null;
      if (meta) { try { userData = JSON.parse(meta); } catch {} }
      const u = userData?.userData;
      if (u?.id) {
        return { ok: true, user_id: String(u.id), name: String(u.name || u.account || '') };
      }
      const r = await fetch('/ajax/user/extra', { credentials: 'include', headers: { Accept: 'application/json' } });
      if (r.status === 401 || r.status === 403) {
        return { kind: 'auth', detail: 'Pixiv /ajax/user/extra HTTP ' + r.status };
      }
      if (!r.ok) return { kind: 'http', httpStatus: r.status };
      const d = await r.json();
      if (d?.error) return { kind: 'auth', detail: 'Pixiv /ajax/user/extra error=true — anonymous' };
      const phpSess = (document.cookie.split('; ').find(c => c.startsWith('PHPSESSID=')) || '').split('=')[1] || '';
      const uid = phpSess.split('_')[0] || '';
      if (!uid) {
        return { kind: 'auth', detail: 'Pixiv PHPSESSID prefix unparseable' };
      }
      return { ok: true, user_id: uid, name: '' };
    } catch (e) {
      return { kind: 'exception', detail: String(e && e.message || e) };
    }
  })()`);
  if (probe?.kind === 'auth') throw new AuthRequiredError('pixiv.net', probe.detail);
  if (probe?.kind === 'http') throw new CommandExecutionError(`HTTP ${probe.httpStatus} from Pixiv ajax`);
  if (probe?.kind === 'exception') throw new CommandExecutionError(`Pixiv whoami failed: ${probe.detail}`);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Pixiv probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, name: probe.name };
}

registerSiteAuthCommands({
  site: 'pixiv',
  domain: 'pixiv.net',
  loginUrl: 'https://accounts.pixiv.net/login',
  columns: ['user_id', 'name'],
  quickCheck: hasPixivSessionCookie,
  verify: verifyPixivIdentity,
  poll: async (page) => {
    if (!await hasPixivSessionCookie(page)) {
      throw new AuthRequiredError('pixiv.net', 'Waiting for Pixiv PHPSESSID cookie');
    }
    return verifyPixivIdentity(page);
  },
});
