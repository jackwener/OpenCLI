/**
 * V2EX Me (Profile/Balance) adapter.
 */
import { CommandExecutionError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

cli({
  site: 'v2ex',
  name: 'me',
  description: 'V2EX 获取个人资料 (余额/未读提醒)',
  domain: 'www.v2ex.com',
  strategy: Strategy.COOKIE,
  browser: true,

  args: [],
  columns: ['username', 'balance', 'unread_notifications', 'daily_reward_ready'],
  func: async (page: IPage | null) => {
    if (!page) throw new CommandExecutionError('Browser page required');

    if (process.env.OPENCLI_VERBOSE) {
      console.error('[opencli:v2ex] Navigating to /');
    }
    await page.goto('https://www.v2ex.com/');
    
    // Cloudflare challenge bypass wait
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 1500));
      const title = await page.evaluate(`() => document.title`);
      if (!title?.includes('Just a moment')) break;
      if (process.env.OPENCLI_VERBOSE) console.error('[opencli:v2ex] Waiting for Cloudflare...');
    }
    
    // Evaluate DOM to extract user profile
    const data = await page.evaluate(`
      async () => {
        let username = 'Unknown';
        const navLinks = Array.from(document.querySelectorAll('a.top')).map(a => a.textContent?.trim());
        if (navLinks.length > 1 && navLinks[0] === '首页') {
          username = navLinks[1] || 'Unknown';
        }
        
        if (username === 'Unknown') {
          // Fallback check just in case
          const profileEl = document.querySelector('a[href^="/member/"]');
          if (profileEl && profileEl.textContent && profileEl.textContent.trim().length > 0) {
            username = profileEl.textContent.trim();
          }
        }

        let balance = '0';
        const balanceLink = document.querySelector('a.balance_area');
        if (balanceLink) {
          balance = Array.from(balanceLink.childNodes)
                         .filter(n => n.nodeType === 3)
                         .map(n => n.textContent?.trim())
                         .join(' ')
                         .trim();
        }

        let unread_notifications = '0';
        const notesEl = document.querySelector('a[href="/notifications"]');
        if (notesEl) {
          const text = notesEl.textContent?.trim() || '';
          const match = text.match(/(\\d+)\\s*未读提醒/);
          if (match) {
            unread_notifications = match[1];
          }
        }

        let daily_reward_ready = false;
        const dailyEl = document.querySelector('a[href^="/mission/daily"]');
        if (dailyEl && dailyEl.textContent?.includes('领取今日的登录奖励')) {
          daily_reward_ready = true;
        }

        if (username === 'Unknown') {
          return { 
            error: '请先登录 V2EX（可能是 Cookie 未配置或已失效）',
            debug_title: document.title,
            debug_body: document.body.innerText.substring(0, 200).replace(/\\n/g, ' ')
          };
        }

        return {
          username,
          balance,
          unread_notifications,
          daily_reward_ready: daily_reward_ready ? '是' : '否'
        };
      }
    `);

    if (data.error) {
      if (process.env.OPENCLI_VERBOSE) {
        console.error(`[opencli:v2ex:debug] Page Title: ${data.debug_title}`);
        console.error(`[opencli:v2ex:debug] Page Body: ${data.debug_body}`);
      }
      throw new CommandExecutionError(data.error);
    }

    return [data];
  },
});
