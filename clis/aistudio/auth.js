import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { AISTUDIO_DOMAIN, AISTUDIO_HOME } from './utils.js';

async function hasGoogleSessionCookie(page) {
  const cookies = await page.getCookies({ url: `https://${AISTUDIO_DOMAIN}` });
  const names = new Set(cookies.map((cookie) => cookie.name));
  return names.has('SID') || names.has('SAPISID') || names.has('__Secure-1PSID');
}

export async function verifyAIStudioIdentity(page) {
  if (!await hasGoogleSessionCookie(page)) {
    throw new AuthRequiredError(AISTUDIO_DOMAIN, 'Google session cookies (SID / SAPISID) missing');
  }
  // Do not yank an already-open AI Studio page away during login polling or
  // whoami; only navigate when the page is somewhere else entirely. A Google
  // auth page (2FA / consent) is "somewhere else" but must never be navigated
  // away from — the session cookie can be present before the flow finishes.
  const currentUrl = String(await page.evaluate('() => window.location.href').catch(() => ''));
  const onAIStudio = /^https:\/\/aistudio\.google\.com\/prompts\//i.test(currentUrl);
  const onGoogleAuth = /^https:\/\/accounts\.google\.com\//i.test(currentUrl);
  if (onGoogleAuth) {
    throw new AuthRequiredError(AISTUDIO_DOMAIN, 'Google login flow still in progress (2FA or consent); not navigating away');
  }
  if (!onAIStudio) {
    await page.goto(AISTUDIO_HOME);
    await page.wait(2);
  }
  const probe = await page.evaluate(`
    (() => {
      const account = document.querySelector(
        'ms-account-switcher [role="button"], #account-switcher-button [role="button"]',
      );
      if (!account) {
        return { kind: 'auth', detail: 'AI Studio account switcher missing — not signed into Google' };
      }
      const label = String(account.getAttribute('aria-label') || account.textContent || '')
        .replace(/\\s+/g, ' ')
        .trim();
      const match = label.match(
        /(?:Google 账号|Google Account|账号|Account)\\s*[:\uff1a]?\\s*([^(]+?)\\s*\\(([^)]+)\\)/i,
      );
      if (match) return { ok: true, name: match[1].trim(), email: match[2].trim() };
      return { ok: true, name: label };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError(AISTUDIO_DOMAIN, probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected AI Studio probe: ${JSON.stringify(probe)}`);
  return { name: probe.name, email: probe.email };
}

registerSiteAuthCommands({
  site: 'aistudio',
  domain: AISTUDIO_DOMAIN,
  loginUrl: `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(AISTUDIO_HOME)}`,
  columns: ['name', 'email'],
  quickCheck: hasGoogleSessionCookie,
  verify: verifyAIStudioIdentity,
  poll: async (page) => {
    if (!await hasGoogleSessionCookie(page)) {
      throw new AuthRequiredError(AISTUDIO_DOMAIN, 'Waiting for Google session cookies');
    }
    return verifyAIStudioIdentity(page);
  },
});
