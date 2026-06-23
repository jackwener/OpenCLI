import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function has1688LogonCookie(page) {
  const cookies = await page.getCookies({ url: 'https://www.1688.com' });
  return cookies.some(c => c.name === '__cn_logon__' && c.value === 'true');
}

async function verify1688Identity(page) {
  if (!await has1688LogonCookie(page)) {
    throw new AuthRequiredError('1688.com', '1688 __cn_logon__=true cookie missing — anonymous');
  }
  await page.goto('https://www.1688.com/');
  await page.wait(2);
  const cookies = await page.getCookies({ url: 'https://www.1688.com' });
  const cookieMap = Object.fromEntries(cookies.map(c => [c.name, c.value]));
  if (cookieMap['__cn_logon__'] !== 'true') {
    throw new AuthRequiredError('1688.com', '1688 __cn_logon__ cookie absent after navigation');
  }
  const unb = cookieMap['unb'] || '';
  if (!unb) {
    throw new AuthRequiredError('1688.com', '1688 unb cookie missing — partial logged-in state');
  }
  let name = '';
  try {
    name = cookieMap['lid'] ? decodeURIComponent(cookieMap['lid']) : '';
  } catch {
    name = cookieMap['lid'] || '';
  }
  return { user_id: String(unb), name };
}

registerSiteAuthCommands({
  site: '1688',
  domain: '1688.com',
  loginUrl: 'https://login.1688.com/member/signin.htm',
  columns: ['user_id', 'name'],
  quickCheck: has1688LogonCookie,
  verify: verify1688Identity,
  poll: async (page) => {
    if (!await has1688LogonCookie(page)) {
      throw new AuthRequiredError('1688.com', 'Waiting for 1688 __cn_logon__=true cookie');
    }
    return verify1688Identity(page);
  },
});
