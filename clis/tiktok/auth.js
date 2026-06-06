import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasTiktokSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.tiktok.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('sessionid') || names.has('sid_tt') || names.has('uid_tt');
}

async function verifyTiktokIdentity(page) {
  if (!await hasTiktokSessionCookie(page)) {
    throw new AuthRequiredError('www.tiktok.com', 'TikTok session cookies (sessionid/sid_tt/uid_tt) missing');
  }
  await page.goto('https://www.tiktok.com/foryou');
  await page.wait(2);
  const info = await page.evaluate(`
    (() => {
      const raw = document.querySelector('script[id="__UNIVERSAL_DATA_FOR_REHYDRATION__"]')?.textContent;
      if (!raw) return null;
      let data;
      try { data = JSON.parse(raw); } catch { return null; }
      const scope = data?.['__DEFAULT_SCOPE__'] || {};
      const seen = new Set();
      const stack = [scope];
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        if (Array.isArray(node)) { stack.push(...node); continue; }
        const u = node.user;
        if (u && typeof u === 'object') {
          const isMe = Boolean(u.isOwner || u.is_owner || u.isCurrentUser);
          if (isMe && (u.secUid || u.sec_uid)) {
            return {
              sec_uid: String(u.secUid || u.sec_uid),
              username: String(u.uniqueId || u.unique_id || u.username || ''),
              nickname: String(u.nickname || u.nickName || ''),
            };
          }
        }
        for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v);
      }
      return null;
    })()
  `);
  if (!info?.sec_uid) {
    throw new AuthRequiredError('www.tiktok.com', 'TikTok universal data has no owner user — identity not rehydrated');
  }
  return { sec_uid: info.sec_uid, username: info.username, nickname: info.nickname };
}

registerSiteAuthCommands({
  site: 'tiktok',
  domain: 'tiktok.com',
  loginUrl: 'https://www.tiktok.com/login',
  columns: ['sec_uid', 'username', 'nickname'],
  quickCheck: hasTiktokSessionCookie,
  verify: verifyTiktokIdentity,
  poll: async (page) => {
    if (!await hasTiktokSessionCookie(page)) {
      throw new AuthRequiredError('www.tiktok.com', 'Waiting for TikTok session cookies');
    }
    return verifyTiktokIdentity(page);
  },
});
