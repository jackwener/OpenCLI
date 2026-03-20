/**
 * BOSS直聘 greet — send greeting to a new candidate (initiate chat).
 *
 * This is different from send.ts which messages existing contacts.
 * For new candidates (from recommend list), we navigate to their chat page
 * and use UI automation to send the greeting message.
 *
 * The greetRecSortList provides candidates who have applied or been recommended.
 * We click on them in the list and send a greeting.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'greet',
  description: 'BOSS直聘向新候选人发送招呼（开始聊天）',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'uid', required: true, help: 'Encrypted UID of the candidate (from recommend)' },
    { name: 'security_id', required: true, help: 'Security ID of the candidate' },
    { name: 'job_id', required: true, help: 'Encrypted job ID' },
    { name: 'text', default: '', help: 'Custom greeting message (uses default template if empty)' },
  ],
  columns: ['status', 'detail'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const uid = kwargs.uid;
    const securityId = kwargs.security_id;
    const jobId = kwargs.job_id;
    const text = kwargs.text;

    if (process.env.OPENCLI_VERBOSE) {
      console.error(`[opencli:boss] Greeting candidate ${uid}...`);
    }

    // Navigate to chat page
    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 3 });

    // Find the candidate in the greet list by encryptUid
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
      throw new Error(`获取候选人列表失败: ${listData.message}`);
    }

    // Also check the regular friend list
    let target: any = null;
    const greetList = listData.zpData?.friendList || [];
    target = greetList.find((f: any) => f.encryptUid === uid);

    let numericUid: string | null = null;
    let friendName = '候选人';

    if (target) {
      numericUid = target.uid;
      friendName = target.name || friendName;
    }

    if (!numericUid) {
      // Try to find in friend list
      const friendData: any = await page.evaluate(`
        async () => {
          return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'https://www.zhipin.com/wapi/zprelation/friend/getBossFriendListV2.json?page=1&status=0&jobId=0', true);
            xhr.withCredentials = true;
            xhr.timeout = 15000;
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { reject(e); } };
            xhr.onerror = () => reject(new Error('Network Error'));
            xhr.send();
          });
        }
      `);

      if (friendData.code === 0) {
        const allFriends = friendData.zpData?.friendList || [];
        const found = allFriends.find((f: any) => f.encryptUid === uid);
        if (found) {
          numericUid = found.uid;
          friendName = found.name || friendName;
        }
      }
    }

    if (!numericUid) {
      throw new Error('未找到该候选人，请确认 uid 是否正确（可从 recommend 命令获取）');
    }

    // Click on the candidate in the chat list
    const clicked: any = await page.evaluate(`
      async () => {
        const item = document.querySelector('#_${numericUid}-0') || document.querySelector('[id^="_${numericUid}"]');
        if (item) {
          item.click();
          return { clicked: true, id: item.id };
        }
        const items = document.querySelectorAll('.geek-item');
        for (const el of items) {
          if (el.id && el.id.startsWith('_${numericUid}')) {
            el.click();
            return { clicked: true, id: el.id };
          }
        }
        return { clicked: false };
      }
    `);

    if (!clicked.clicked) {
      throw new Error('无法在聊天列表中找到该用户，候选人可能不在当前列表中');
    }

    await page.wait({ time: 2 });

    // Type the message
    const msgText = text || '你好，请问您对这个职位感兴趣吗？';

    const typed: any = await page.evaluate(`
      async () => {
        const selectors = [
          '.chat-editor [contenteditable="true"]',
          '.chat-input [contenteditable="true"]',
          '.message-editor [contenteditable="true"]',
          '.chat-conversation [contenteditable="true"]',
          '[contenteditable="true"]',
          'textarea',
        ];
        
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) {
            el.focus();
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
              el.value = ${JSON.stringify(msgText)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
              el.textContent = '';
              el.focus();
              document.execCommand('insertText', false, ${JSON.stringify(msgText)});
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return { found: true, selector: sel };
          }
        }
        return { found: false };
      }
    `);

    if (!typed.found) {
      throw new Error('找不到消息输入框');
    }

    await page.wait({ time: 0.5 });

    // Click send button
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

    await page.wait({ time: 1 });

    return [{ status: '✅ 招呼已发送', detail: `已向 ${friendName} 发送: ${msgText}` }];
  },
});
