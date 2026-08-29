import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { GMAIL_HOST, GMAIL_ORIGIN, unwrapBrowserResult } from './utils.js';

async function hasGoogleSession(page) {
  const cookies = await page.getCookies({ url: GMAIL_ORIGIN });
  const names = new Set(cookies.map((cookie) => cookie.name));
  return names.has('SID') || names.has('__Secure-1PSID') || names.has('SAPISID');
}

async function verifyGmailIdentity(page) {
  if (!await hasGoogleSession(page)) {
    throw new AuthRequiredError(GMAIL_HOST, 'Google session cookies are missing');
  }
  await page.goto(`${GMAIL_ORIGIN}/mail/u/0/#inbox`);
  await page.sleep(2);
  const result = unwrapBrowserResult(await page.evaluate(`(() => {
    const account = Array.from(document.querySelectorAll('a[aria-label], button[aria-label]'))
      .map((node) => String(node.getAttribute('aria-label') || '').trim())
      .find((label) => /@/.test(label) && /(google account|google 帐号|google 账号)/i.test(label));
    if (!account) {
      const login = document.querySelector('a[href*="accounts.google.com/ServiceLogin"], input[type="email"]');
      return login
        ? { kind: 'auth', detail: 'Gmail shows a Google sign-in surface' }
        : { kind: 'shape', detail: 'Gmail account control was not found' };
    }
    const email = account.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
    const beforeEmail = email ? account.slice(0, account.indexOf(email)) : account;
    const name = beforeEmail
      .replace(/^.*?(?:google account|google 帐号|google 账号)\s*[:：]?\s*/i, '')
      .replace(/[,(（]\s*$/, '')
      .trim();
    return email ? { ok: true, email, name } : { kind: 'shape', detail: 'Gmail account control did not expose an email address' };
  })()`), 'identity probe');
  if (result?.kind === 'auth') throw new AuthRequiredError(GMAIL_HOST, result.detail);
  if (!result?.ok) throw new CommandExecutionError(result?.detail || 'Gmail identity probe returned an unexpected result');
  return { email: result.email, name: result.name || null };
}

registerSiteAuthCommands({
  site: 'gmail',
  domain: GMAIL_HOST,
  loginUrl: 'https://accounts.google.com/ServiceLogin?service=mail&continue=https%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0%2F%23inbox',
  columns: ['email', 'name'],
  quickCheck: hasGoogleSession,
  verify: verifyGmailIdentity,
  poll: verifyGmailIdentity,
});
