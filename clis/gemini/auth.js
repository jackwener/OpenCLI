import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasGoogleSessionCookie(page) {
  const cookies = await page.getCookies({ url: 'https://gemini.google.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('SID') || names.has('SAPISID') || names.has('__Secure-1PSID');
}

async function verifyGeminiIdentity(page) {
  if (!await hasGoogleSessionCookie(page)) {
    throw new AuthRequiredError('gemini.google.com', 'Google session cookies (SID / SAPISID) missing');
  }
  await page.goto('https://gemini.google.com/app');
  await page.wait(3);
  const probe = await page.evaluate(`
    (() => {
      const a = document.querySelector('a[aria-label^="Google Account:"]');
      if (!a) {
        return { kind: 'auth', detail: 'Gemini account link missing — not signed into Google' };
      }
      const label = a.getAttribute('aria-label') || '';
      const m = label.match(/Google Account:\\s*([^(]+?)\\s*\\(([^)]+)\\)/);
      if (!m) {
        return { kind: 'auth', detail: 'Gemini aria-label unparseable: ' + label };
      }
      return { ok: true, name: m[1].trim() };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('gemini.google.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Gemini probe: ${JSON.stringify(probe)}`);
  return { name: probe.name };
}

registerSiteAuthCommands({
  site: 'gemini',
  domain: 'gemini.google.com',
  loginUrl: 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2F',
  columns: ['name'],
  quickCheck: hasGoogleSessionCookie,
  verify: verifyGeminiIdentity,
  poll: async (page) => {
    if (!await hasGoogleSessionCookie(page)) {
      throw new AuthRequiredError('gemini.google.com', 'Waiting for Google session cookies');
    }
    return verifyGeminiIdentity(page);
  },
});
