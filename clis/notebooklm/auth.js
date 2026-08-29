import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_HOME_URL } from './shared.js';
import { unwrapNotebooklmEvaluateResult } from './rpc.js';

async function hasNotebookLmSsoCookies(page) {
  const cookies = await page.getCookies({ url: NOTEBOOKLM_HOME_URL });
  const names = new Set(cookies.map(c => c.name));
  return names.has('SID') && names.has('SAPISID');
}

async function verifyNotebookLmIdentity(page) {
  if (!await hasNotebookLmSsoCookies(page)) {
    throw new AuthRequiredError(NOTEBOOKLM_DOMAIN, 'Google SSO cookies (SID + SAPISID) missing');
  }
  await page.goto(NOTEBOOKLM_HOME_URL);
  await page.wait(3);
  const probe = unwrapNotebooklmEvaluateResult(await page.evaluate(`
    (() => {
      if (/accounts\\.google\\.com\\/ServiceLogin/.test(location.href) || /accounts\\.google\\.com\\/signin/i.test(location.href)) {
        return { kind: 'auth', detail: 'NotebookLM redirected to Google sign-in' };
      }
      const acctEl = document.querySelector('a[aria-label^="Google Account:"], a[aria-label*="Google 账号:"]');
      if (!acctEl) {
        return { kind: 'auth', detail: 'NotebookLM missing Google Account button' };
      }
      const label = acctEl.getAttribute('aria-label') || '';
      const nameMatch = label.match(/Google Account:\\s*([^\\n\\(]+?)(?:\\s*\\n|\\s*\\()/i) ||
                        label.match(/Google 账号:\\s*([^\\n\\(]+?)(?:\\s*\\n|\\s*\\()/i);
      const name = nameMatch ? nameMatch[1].trim() : '';
      const authuserMatch = location.href.match(/[?&]authuser=(\\d+)/);
      const authuser = authuserMatch ? Number(authuserMatch[1]) : 0;
      if (!name) {
        return { kind: 'auth', detail: 'NotebookLM Google Account aria-label found but name unparseable' };
      }
      return { ok: true, name, authuser };
    })()
  `));
  if (probe?.kind === 'auth') throw new AuthRequiredError(NOTEBOOKLM_DOMAIN, probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected NotebookLM probe: ${JSON.stringify(probe)}`);
  return { name: probe.name, authuser: probe.authuser };
}

registerSiteAuthCommands({
  site: 'notebooklm',
  domain: 'google.com',
  loginUrl: `https://accounts.google.com/ServiceLogin?service=lso&continue=${encodeURIComponent(NOTEBOOKLM_HOME_URL)}`,
  columns: ['name', 'authuser'],
  quickCheck: hasNotebookLmSsoCookies,
  verify: verifyNotebookLmIdentity,
  poll: async (page) => {
    if (!await hasNotebookLmSsoCookies(page)) {
      throw new AuthRequiredError(NOTEBOOKLM_DOMAIN, 'Waiting for Google SSO cookies (SID + SAPISID)');
    }
    return verifyNotebookLmIdentity(page);
  },
});
