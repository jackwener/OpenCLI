import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';

async function hasCtripLoginUid(page) {
  const cookies = await page.getCookies({ url: 'https://www.ctrip.com' });
  const loginUid = cookies.find(c => c.name === 'login_uid');
  return Boolean(loginUid && loginUid.value);
}

async function verifyCtripIdentity(page) {
  if (!await hasCtripLoginUid(page)) {
    throw new AuthRequiredError('ctrip.com', 'Ctrip login_uid cookie missing — anonymous');
  }
  await page.goto('https://my.ctrip.com/myinfo/MyInfoIndex.aspx');
  await page.wait(2);
  const cookies = await page.getCookies({ url: 'https://www.ctrip.com' });
  const cookieMap = Object.fromEntries(cookies.map(c => [c.name, c.value]));
  const loginUid = cookieMap['login_uid'] || '';
  if (!loginUid) {
    throw new AuthRequiredError('ctrip.com', 'Ctrip login_uid cookie absent after navigation');
  }
  const aheadRaw = cookieMap['AHeadUserInfo'] || '';
  const params = new URLSearchParams(aheadRaw);
  const userNameRaw = params.get('UserName') || '';
  let userName = '';
  if (userNameRaw) {
    try {
      userName = decodeURIComponent(userNameRaw);
    } catch {
      userName = userNameRaw;
    }
  }
  const vipGrade = params.get('VipGrade') || '';
  return { user_id: loginUid, name: userName, vip_grade: vipGrade };
}

registerSiteAuthCommands({
  site: 'ctrip',
  domain: 'ctrip.com',
  loginUrl: 'https://passport.ctrip.com/user/login',
  columns: ['user_id', 'name', 'vip_grade'],
  quickCheck: hasCtripLoginUid,
  verify: verifyCtripIdentity,
  poll: async (page) => {
    if (!await hasCtripLoginUid(page)) {
      throw new AuthRequiredError('ctrip.com', 'Waiting for Ctrip login_uid cookie');
    }
    return verifyCtripIdentity(page);
  },
});
