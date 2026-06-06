import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasAmazonSessionCookies(page) {
  const cookies = await page.getCookies({ url: 'https://www.amazon.com' });
  const names = new Set(cookies.map(c => c.name));
  return names.has('at-main') || names.has('x-main');
}

async function verifyAmazonIdentity(page) {
  if (!await hasAmazonSessionCookies(page)) {
    throw new AuthRequiredError('amazon.com', 'Amazon auth cookies (at-main / x-main) are missing');
  }
  await page.goto('https://www.amazon.com/', { waitUntil: 'load' });
  await page.wait(3);
  const probe = await page.evaluate(`
    (() => {
      const navLink = document.querySelector('#nav-link-accountList');
      if (!navLink) {
        return { kind: 'auth', detail: 'Amazon header missing nav-link-accountList — layout changed or robot challenge' };
      }
      const greeting = (navLink.querySelector('.nav-line-1, #nav-link-accountList-nav-line-1') || {}).textContent || '';
      const trimmed = greeting.trim();
      if (/sign\\s*in/i.test(trimmed)) {
        return { kind: 'auth', detail: 'Amazon header shows "Hello, sign in" — anonymous' };
      }
      const m = trimmed.match(/^Hello,?\\s+(.+)$/i);
      const name = m ? m[1].trim() : '';
      if (!name) {
        return { kind: 'auth', detail: 'Amazon greeting unparseable: ' + trimmed };
      }
      return { ok: true, user_name: name };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('amazon.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected Amazon probe: ${JSON.stringify(probe)}`);
  return { user_name: probe.user_name };
}

registerSiteAuthCommands({
  site: 'amazon',
  domain: 'amazon.com',
  loginUrl: 'https://www.amazon.com/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.com%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0',
  columns: ['user_name'],
  quickCheck: hasAmazonSessionCookies,
  verify: verifyAmazonIdentity,
  poll: async (page) => {
    if (!await hasAmazonSessionCookies(page)) {
      throw new AuthRequiredError('amazon.com', 'Waiting for Amazon at-main / x-main cookie');
    }
    return verifyAmazonIdentity(page);
  },
});
