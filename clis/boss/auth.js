import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasBossSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.zhipin.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('wt2') || names.has('t');
}

async function verifyBossIdentity(page) {
  if (!await hasBossSessionCookie(page)) {
    throw new AuthRequiredError('zhipin.com', 'Boss wt2 / t cookies missing');
  }
  await page.goto('https://www.zhipin.com/web/geek/job-recommend');
  await page.wait(3);
  const probe = await page.evaluate(`
    (() => {
      const path = location.pathname || '';
      if (/\\/web\\/user\\/login|\\/login\\.html/.test(location.href)) {
        return { kind: 'auth', detail: 'Boss redirected to login page' };
      }
      const userType = /\\/web\\/geek\\//.test(path) ? 'geek' : /\\/web\\/(boss|recruit|chat\\/boss)/.test(path) ? 'recruiter' : '';
      if (!userType) {
        return { kind: 'auth', detail: 'Boss path does not look like authenticated geek/recruiter page: ' + path };
      }
      return { ok: true, user_type: userType };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('zhipin.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Boss probe: ${JSON.stringify(probe)}`);
  return { user_type: probe.user_type };
}

registerSiteAuthCommands({
  site: 'boss',
  domain: 'zhipin.com',
  loginUrl: 'https://login.zhipin.com/',
  columns: ['user_type'],
  quickCheck: hasBossSessionCookie,
  verify: verifyBossIdentity,
  poll: async (page) => {
    if (!await hasBossSessionCookie(page)) {
      throw new AuthRequiredError('zhipin.com', 'Waiting for Boss wt2 / t cookies');
    }
    return verifyBossIdentity(page);
  },
});
