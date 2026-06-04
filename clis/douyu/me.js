import { cli, Strategy } from '@jackwener/opencli/registry';
import { requireDouyuLogin } from './public-utils.js';

export const command = cli({
  site: 'douyu',
  name: 'me',
  description: '获取当前斗鱼登录用户信息',
  access: 'read',
  example: 'opencli douyu me -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [],
  columns: ['uid', 'nickname', 'logged_in'],
  func: async (page) => {
    await page.goto('https://www.douyu.com/', { waitUntil: 'load', settleMs: 3000 });
    await page.wait({ time: 3 });
    const result = await page.evaluate(`
      (() => {
        const cookieUid = document.cookie.match(/(?:^|;\\s*)acf_uid=([^;]+)/)?.[1] || '';
        const isUnLogin = !!document.querySelector('.Header-login-wrap .UnLogin, a[href="/member/login"]');
        const candidates = Array.from(document.querySelectorAll(
          '[class*="nickname"], [class*="userName"], [class*="user-name"], [class*="NickName"]'
        )).map((node) => (node.textContent || '').trim()).filter(Boolean);
        return {
          uid: cookieUid ? decodeURIComponent(cookieUid) : '',
          nickname: candidates[0] || '',
          loggedIn: !!cookieUid && !isUnLogin,
        };
      })()
    `);

    if (!result?.loggedIn) {
      requireDouyuLogin('Could not detect logged-in Douyu user');
    }

    return [{
      uid: result.uid,
      nickname: result.nickname || result.uid,
      logged_in: true,
    }];
  },
});
