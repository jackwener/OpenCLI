import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasToutiaoSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://mp.toutiao.com' });
  return cookies.some(c => c.name === 'sessionid' && c.value);
}

async function verifyToutiaoIdentity(page) {
  if (!await hasToutiaoSessionCookie(page)) {
    throw new AuthRequiredError('toutiao.com', 'Toutiao sessionid cookie missing');
  }
  await page.goto('https://mp.toutiao.com/');
  await page.wait(2);
  const probe = await page.evaluate(`
    (() => {
      if (/\\/auth\\/page\\/login/.test(location.href)) {
        return { kind: 'auth', detail: 'mp.toutiao.com redirected to /auth/page/login — anonymous' };
      }
      let userId = '', nickname = '';
      try {
        const seen = new Set();
        const stack = [window.__INITIAL_STATE__, window.__REDUX_STATE__, window.__SSR_DATA__].filter(Boolean);
        while (stack.length) {
          const node = stack.pop();
          if (!node || typeof node !== 'object' || seen.has(node)) continue;
          seen.add(node);
          if (Array.isArray(node)) { stack.push(...node); continue; }
          const u = node.userInfo || node.user || node.currentUser || node.userBase;
          if (u && typeof u === 'object' && (u.user_id || u.userId || u.uid)) {
            userId = String(u.user_id || u.userId || u.uid || '');
            nickname = String(u.screen_name || u.name || u.nickname || u.user_name || '');
            break;
          }
          for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v);
        }
      } catch {}
      if (!userId) {
        const ssoUid = (document.cookie.split('; ').find(c => c.startsWith('sso_uid=')) || '').split('=')[1] || '';
        if (ssoUid) userId = ssoUid;
      }
      if (!nickname) {
        const el = document.querySelector('.user-name, .header-username, .avatar-name, [class*="userName"]');
        nickname = (el?.innerText || '').trim();
      }
      if (!userId) {
        return { kind: 'auth', detail: 'Toutiao dashboard rendered but no user_id surface — stale session' };
      }
      return { ok: true, user_id: userId, nickname };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('toutiao.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Toutiao probe: ${JSON.stringify(probe)}`);
  return { user_id: probe.user_id, nickname: probe.nickname };
}

registerSiteAuthCommands({
  site: 'toutiao',
  domain: 'toutiao.com',
  loginUrl: 'https://mp.toutiao.com/auth/page/login',
  columns: ['user_id', 'nickname'],
  quickCheck: hasToutiaoSessionCookie,
  verify: verifyToutiaoIdentity,
  poll: async (page) => {
    if (!await hasToutiaoSessionCookie(page)) {
      throw new AuthRequiredError('toutiao.com', 'Waiting for Toutiao sessionid cookie');
    }
    return verifyToutiaoIdentity(page);
  },
});
