/**
 * V2EX Daily Check-in adapter.
 */
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'v2ex',
    name: 'daily',
    access: 'write',
    description: 'V2EX 每日签到并领取铜币',
    domain: 'www.v2ex.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [],
    columns: ['status', 'message'],
    func: async (page) => {
        if (!page)
            throw new CommandExecutionError('Browser page required');
        if (process.env.OPENCLI_VERBOSE) {
            console.error('[opencli:v2ex] Navigating to /mission/daily');
        }
        await page.goto('https://www.v2ex.com/mission/daily');
        // Cloudflare challenge bypass wait
        for (let i = 0; i < 5; i++) {
            await new Promise(r => setTimeout(r, 1500));
            const title = await page.evaluate(`() => document.title`);
            if (!title?.includes('Just a moment'))
                break;
            if (process.env.OPENCLI_VERBOSE)
                console.error('[opencli:v2ex] Waiting for Cloudflare...');
        }
        // Evaluate DOM to find if we need to check in
        const checkResult = await page.evaluate(`
      async () => {
        const btn = document.querySelector('input.super.normal.button');
        if (!btn || !btn.value.includes('领取')) {
          return { claimed: true, message: '今日奖励已发/无需领取' };
        }
        
        const onclick = btn.getAttribute('onclick');
        if (onclick) {
          const match = onclick.match(/once=(\\d+)/);
          if (match) {
            return { claimed: false, once: match[1], message: btn.value };
          }
        }
        
        return { 
          claimed: false, 
          error: '找到了按钮，但未能提取 once token',
          debug_title: document.title,
          debug_body: document.body.innerText.substring(0, 200).replace(/\\n/g, ' ')
        };
      }
    `);
        if (checkResult.error) {
            if (process.env.OPENCLI_VERBOSE) {
                console.error(`[opencli:v2ex:debug] Page Title: ${checkResult.debug_title}`);
                console.error(`[opencli:v2ex:debug] Page Body: ${checkResult.debug_body}`);
            }
            throw new CommandExecutionError(checkResult.error);
        }
        if (checkResult.claimed) {
            return [{ status: '✅ 已签到', message: checkResult.message }];
        }
        // Perform check in
        if (process.env.OPENCLI_VERBOSE) {
            console.error(`[opencli:v2ex] Found check-in token: once=${checkResult.once}. Checking in...`);
        }
        await page.goto(`https://www.v2ex.com/mission/daily/redeem?once=${checkResult.once}`);
        await new Promise(resolve => setTimeout(resolve, 3000)); // wait longer for redirect
        // Verify result
        const verifyResult = await page.evaluate(`
      async () => {
        const btn = document.querySelector('input.super.normal.button');
        if (!btn || !btn.value.includes('领取')) {
          // fetch balance to show user
          let balance = '';
          const balanceLink = document.querySelector('a.balance_area');
          if (balanceLink) {
            balance = Array.from(balanceLink.childNodes)
                           .filter(n => n.nodeType === 3)
                           .map(n => n.textContent?.trim())
                           .join(' ')
                           .trim();
          }
          return { success: true, balance };
        }
        return { success: false };
      }
    `);
        if (verifyResult.success) {
            return [{ status: '🎉 签到成功', message: `当前余额: ${verifyResult.balance || '未知'}` }];
        }
        else {
            return [{ status: '❌ 签到失败', message: '未能确认签到结果，请手动检查' }];
        }
    },
});
