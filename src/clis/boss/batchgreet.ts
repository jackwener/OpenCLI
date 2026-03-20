/**
 * BOSS直聘 batchgreet — batch greet recommended candidates.
 *
 * Combines recommend (greetRecSortList) + greet (UI automation).
 * Sends greeting messages to multiple candidates sequentially.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'batchgreet',
  description: 'BOSS直聘批量向推荐候选人发送招呼',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'job_id', default: '', help: 'Filter by encrypted job ID (greet all jobs if empty)' },
    { name: 'limit', type: 'int', default: 5, help: 'Max candidates to greet' },
    { name: 'text', default: '', help: 'Custom greeting message (uses default if empty)' },
  ],
  columns: ['name', 'status', 'detail'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const filterJobId = kwargs.job_id || '';
    const limit = kwargs.limit || 5;
    const text = kwargs.text || '你好，请问您对这个职位感兴趣吗？';

    if (process.env.OPENCLI_VERBOSE) {
      console.error(`[opencli:boss] Batch greeting up to ${limit} candidates...`);
    }

    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 3 });

    // Get recommended candidates
    const listData: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://www.zhipin.com/wapi/zprelation/friend/greetRecSortList', true);
          xhr.withCredentials = true;
          xhr.timeout = 15000;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { reject(e); } };
          xhr.onerror = () => reject(new Error('Network Error'));
          xhr.send();
        });
      }
    `);

    if (listData.code !== 0) {
      if (listData.code === 7 || listData.code === 37) {
        throw new Error('Cookie 已过期！请在当前 Chrome 浏览器中重新登录 BOSS 直聘。');
      }
      throw new Error(`获取推荐列表失败: ${listData.message}`);
    }

    let candidates = listData.zpData?.friendList || [];
    if (filterJobId) {
      candidates = candidates.filter((f: any) => f.encryptJobId === filterJobId);
    }
    candidates = candidates.slice(0, limit);

    if (candidates.length === 0) {
      return [{ name: '-', status: '⚠️ 无候选人', detail: '当前没有待招呼的推荐候选人' }];
    }

    const results: any[] = [];

    for (const candidate of candidates) {
      const numericUid = candidate.uid;
      const friendName = candidate.name || '候选人';

      try {
        // Click on candidate
        const clicked: any = await page.evaluate(`
          async () => {
            const item = document.querySelector('#_${numericUid}-0') || document.querySelector('[id^="_${numericUid}"]');
            if (item) {
              item.click();
              return { clicked: true };
            }
            const items = document.querySelectorAll('.geek-item');
            for (const el of items) {
              if (el.id && el.id.startsWith('_${numericUid}')) {
                el.click();
                return { clicked: true };
              }
            }
            return { clicked: false };
          }
        `);

        if (!clicked.clicked) {
          results.push({ name: friendName, status: '❌ 跳过', detail: '在聊天列表中未找到' });
          continue;
        }

        await page.wait({ time: 2 });

        // Type message
        const typed: any = await page.evaluate(`
          async () => {
            const selectors = [
              '.chat-editor [contenteditable="true"]',
              '.chat-input [contenteditable="true"]',
              '[contenteditable="true"]',
              'textarea',
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.offsetParent !== null) {
                el.focus();
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                  el.value = ${JSON.stringify(text)};
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                  el.textContent = '';
                  el.focus();
                  document.execCommand('insertText', false, ${JSON.stringify(text)});
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                }
                return { found: true };
              }
            }
            return { found: false };
          }
        `);

        if (!typed.found) {
          results.push({ name: friendName, status: '❌ 失败', detail: '找不到消息输入框' });
          continue;
        }

        await page.wait({ time: 0.5 });

        // Click send
        const sent: any = await page.evaluate(`
          async () => {
            const btn = document.querySelector('.conversation-editor .submit') 
                     || document.querySelector('.submit-content .submit')
                     || document.querySelector('.conversation-operate .submit');
            if (btn) {
              btn.click();
              return { clicked: true };
            }
            return { clicked: false };
          }
        `);

        if (!sent.clicked) {
          await page.pressKey('Enter');
        }

        await page.wait({ time: 1.5 });

        results.push({ name: friendName, status: '✅ 已发送', detail: text });
      } catch (e: any) {
        results.push({ name: friendName, status: '❌ 失败', detail: e.message?.substring(0, 80) || '未知错误' });
      }
    }

    return results;
  },
});
