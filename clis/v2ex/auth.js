import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasV2exAuthCookie(page) {
  // A2 is V2EX's httpOnly logged-in session cookie.
  const cookies = await page.getCookies({ url: 'https://www.v2ex.com' });
  return cookies.some(c => c.name === 'A2' && c.value);
}

async function verifyV2exIdentity(page) {
  if (!await hasV2exAuthCookie(page)) {
    throw new AuthRequiredError('v2ex.com', 'V2EX A2 session cookie missing — anonymous');
  }
  await page.goto('https://www.v2ex.com/');
  await page.wait(1);
  const probe = await page.evaluate(`
    (() => {
      const link = document.querySelector('#Top a[href^="/member/"]');
      if (!link) return { kind: 'auth', detail: 'V2EX top bar has no member link — anonymous session' };
      const href = link.getAttribute('href') || '';
      const username = (link.innerText || href.replace('/member/', '')).trim();
      if (!username) return { kind: 'auth', detail: 'V2EX member link present but username empty' };
      return { ok: true, username };
    })()
  `);
  if (probe?.kind === 'auth') throw new AuthRequiredError('v2ex.com', probe.detail);
  if (!probe?.ok) throw new CommandExecutionError(`Unexpected V2EX probe: ${JSON.stringify(probe)}`);
  return { username: probe.username };
}

registerSiteAuthCommands({
  site: 'v2ex',
  domain: 'v2ex.com',
  loginUrl: 'https://www.v2ex.com/signin',
  columns: ['username'],
  quickCheck: hasV2exAuthCookie,
  verify: verifyV2exIdentity,
  poll: async (page) => {
    if (!await hasV2exAuthCookie(page)) {
      throw new AuthRequiredError('v2ex.com', 'Waiting for V2EX A2 session cookie');
    }
    return verifyV2exIdentity(page);
  },
});
