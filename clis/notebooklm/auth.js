import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasNotebookLmSsoCookies(page) {
  const cookies = await page.getCookies({ url: 'https://notebooklm.google.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('SID') && names.has('SAPISID');
}

async function verifyNotebookLmIdentity(page) {
  if (!await hasNotebookLmSsoCookies(page)) {
    throw new AuthRequiredError('notebooklm.google.com', 'Google SSO cookies (SID + SAPISID) missing');
  }
  await page.goto('https://notebooklm.google.com/');
  await page.wait(3);
  const probe = await page.evaluate(`
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
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('notebooklm.google.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected NotebookLM probe: ${JSON.stringify(probe)}`);
  return { name: probe.name, authuser: probe.authuser };
}

registerSiteAuthCommands({
  site: 'notebooklm',
  domain: 'google.com',
  loginUrl: 'https://accounts.google.com/ServiceLogin?service=lso&continue=https%3A%2F%2Fnotebooklm.google.com%2F',
  columns: ['name', 'authuser'],
  quickCheck: hasNotebookLmSsoCookies,
  verify: verifyNotebookLmIdentity,
  poll: async (page) => {
    if (!await hasNotebookLmSsoCookies(page)) {
      throw new AuthRequiredError('notebooklm.google.com', 'Waiting for Google SSO cookies (SID + SAPISID)');
    }
    return verifyNotebookLmIdentity(page);
  },
});
