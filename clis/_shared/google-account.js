import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

// String.raw preserves regex escapes in the JavaScript sent to the browser.
export const GOOGLE_ACCOUNT_PROBE = String.raw`(() => {
  if (location.hostname === 'accounts.google.com') return { kind: 'auth' };
  const prefix = /^(?:Google Account|Google 帐号|Google 账号|Google 帳戶)\s*[:：]\s*/i;
  const controls = Array.from(document.querySelectorAll('a[aria-label], button[aria-label]'));
  const accountLink = controls.find(node => {
    try {
      const url = new URL(node.getAttribute('href') || '', location.href);
      return url.hostname === 'accounts.google.com' && url.pathname === '/SignOutOptions';
    } catch { return false; }
  });
  const label = (accountLink?.getAttribute('aria-label') || '').trim()
    || controls.filter(node => !node.hasAttribute('href'))
      .map(node => (node.getAttribute('aria-label') || '').trim())
      .find(label => prefix.test(label));
  if (!label) {
    const login = document.querySelector('a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/v3/signin"], input[type="email"]');
    return { kind: login ? 'auth' : 'shape' };
  }
  const account = accountLink ? label.replace(/^[^:：]+[:：]\s*/, '') : label.replace(prefix, '');
  const email = account.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const name = (email ? account.slice(0, account.indexOf(email)) : account).replace(/[\s,(（]+$/, '').trim();
  if (!email) return { kind: 'shape' };
  const authuser = Number(new URL(location.href).searchParams.get('authuser') || 0);
  return { ok: true, name, email, authuser: Number.isInteger(authuser) ? authuser : 0 };
})()`;

export async function probeGoogleAccount(page, domain) {
  const raw = await page.evaluate(GOOGLE_ACCOUNT_PROBE);
  const result = raw && typeof raw.session === 'string' ? raw.data : raw;
  if (result?.kind === 'auth') throw new AuthRequiredError(domain, 'Google sign-in is required');
  if (!result?.ok) throw new CommandExecutionError(`Could not read the Google account control on ${domain}; the page may still be loading or its layout changed`);
  return result;
}

export async function waitForGoogleReturn(page, domain) {
  // Inspect the actual location rather than getCurrentUrl's navigation cache.
  const host = await page.evaluate('location.hostname');
  if (host !== domain) throw new AuthRequiredError(domain, 'Waiting for Google sign-in to return to the application');
}
