import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { hasLoginGate, ensureYuanbaoPage, YUANBAO_DOMAIN, YUANBAO_URL } from './shared.js';

async function hasYuanbaoUserCookie(page) {
  const cookies = await page.getCookies({ url: 'https://yuanbao.tencent.com' });
  return cookies.some(c => c.name === 'hy_user' && c.value);
}

async function verifyYuanbaoIdentity(page) {
  await ensureYuanbaoPage(page);
  if (await hasLoginGate(page)) {
    throw new AuthRequiredError(YUANBAO_DOMAIN, 'Yuanbao showed wx login gate — anonymous session');
  }
  const cookies = await page.getCookies({ url: 'https://yuanbao.tencent.com' });
  const hyUser = cookies.find(c => c.name === 'hy_user')?.value || '';
  if (!hyUser) {
    throw new AuthRequiredError(YUANBAO_DOMAIN, 'Yuanbao hy_user cookie missing — anonymous session');
  }
  const probe = await page.evaluate(`
    (() => {
      const bodyText = document.body?.innerText || '';
      const nickMatch = bodyText.match(/用户[a-z0-9]{4,}/i);
      const state = window.__INITIAL_STATE__ || {};
      const seen = new Set();
      const stack = [state];
      let stateNick = '';
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        if (Array.isArray(node)) { stack.push(...node); continue; }
        const u = node.userInfo || node.user;
        if (u && typeof u === 'object' && (u.nickname || u.nick)) {
          stateNick = String(u.nickname || u.nick);
          break;
        }
        for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v);
      }
      return { nickname: stateNick || (nickMatch ? nickMatch[0] : '') };
    })()
  `);
  return { user_id: String(hyUser), nickname: String(probe.nickname || '') };
}

registerSiteAuthCommands({
  site: 'yuanbao',
  domain: YUANBAO_DOMAIN,
  loginUrl: YUANBAO_URL,
  columns: ['user_id', 'nickname'],
  quickCheck: hasYuanbaoUserCookie,
  verify: verifyYuanbaoIdentity,
  poll: async (page) => {
    if (!await hasYuanbaoUserCookie(page)) {
      throw new AuthRequiredError(YUANBAO_DOMAIN, 'Waiting for Yuanbao hy_user cookie');
    }
    return verifyYuanbaoIdentity(page);
  },
});
