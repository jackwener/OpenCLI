import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasDianpingSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.dianping.com' });
  return cookies.some(c => c.name === 'dper' && c.value);
}

async function verifyDianpingIdentity(page) {
  if (!await hasDianpingSessionCookie(page)) {
    throw new AuthRequiredError('dianping.com', 'Dianping dper cookie missing');
  }
  await page.goto('https://www.dianping.com/member/myinformation');
  await page.wait(2);
  const finalUrl = await page.evaluate(`location.href`);
  if (/account\.dianping\.com\/(pc)?login/.test(String(finalUrl || ''))) {
    throw new AuthRequiredError('dianping.com', `Dianping member page redirected to login: ${finalUrl}`);
  }
  const info = await page.evaluate(`
    (() => {
      const nicknameEl = document.querySelector('.user-name, .username, .nickname, .user-info .name');
      const nickname = (nicknameEl?.textContent || '').trim();
      const profileLink = Array.from(document.querySelectorAll('a[href*="/member/"]'))
        .map(a => a.getAttribute('href') || '')
        .find(h => /\\/member\\/\\d+/.test(h));
      const uidMatch = String(profileLink || '').match(/\\/member\\/(\\d+)/);
      return { user_id: uidMatch?.[1] || '', nickname };
    })()
  `);
  if (!info?.user_id) {
    throw new CommandExecutionError('Dianping member page rendered but no user_id link found — stale dper or layout drift');
  }
  return { user_id: String(info.user_id), nickname: String(info.nickname || '') };
}

registerSiteAuthCommands({
  site: 'dianping',
  domain: 'dianping.com',
  loginUrl: 'https://account.dianping.com/pclogin',
  columns: ['user_id', 'nickname'],
  quickCheck: hasDianpingSessionCookie,
  verify: verifyDianpingIdentity,
  poll: async (page) => {
    if (!await hasDianpingSessionCookie(page)) {
      throw new AuthRequiredError('dianping.com', 'Waiting for Dianping dper cookie');
    }
    return verifyDianpingIdentity(page);
  },
});
