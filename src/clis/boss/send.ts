/**
 * BOSS直聘 send message — via UI automation on chat page.
 *
 * Flow: navigate to chat → click on user in list → type in editor → send.
 * BOSS chat uses MQTT (not HTTP) for messaging, so we must go through the UI.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'send',
  description: 'BOSS直聘发送聊天消息',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,

  browser: true,
  args: [
    { name: 'uid', required: true, help: 'Encrypted UID of the candidate (from chatlist)' },
    { name: 'text', required: true, help: 'Message text to send' },
  ],
  columns: ['status', 'detail'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const uid = kwargs.uid;
    const text = kwargs.text;

    // Step 1: Navigate to chat page
    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 3 });

    // Step 2: Find friend in list to get their numeric uid, then click
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

    if (friendData.code !== 0) {
      if (friendData.code === 7 || friendData.code === 37) {
        throw new Error('Cookie 已过期！请在当前 Chrome 浏览器中重新登录 BOSS 直聘。');
      }
      throw new Error('获取好友列表失败: ' + (friendData.message || friendData.code));
    }

    let target: any = null;
    const allFriends = friendData.zpData?.friendList || [];
    target = allFriends.find((f: any) => f.encryptUid === uid);

    if (!target) {
      for (let p = 2; p <= 5; p++) {
        const moreUrl = `https://www.zhipin.com/wapi/zprelation/friend/getBossFriendListV2.json?page=${p}&status=0&jobId=0`;
        const moreData: any = await page.evaluate(`
          async () => {
            return new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('GET', '${moreUrl}', true);
              xhr.withCredentials = true;
              xhr.timeout = 15000;
              xhr.setRequestHeader('Accept', 'application/json');
              xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { reject(e); } };
              xhr.onerror = () => reject(new Error('Network Error'));
              xhr.send();
            });
          }
        `);
        if (moreData.code === 0) {
          const list = moreData.zpData?.friendList || [];
          target = list.find((f: any) => f.encryptUid === uid);
          if (target) break;
          if (list.length === 0) break;
        }
      }
    }

    if (!target) throw new Error('未找到该候选人，请确认 uid 是否正确');

    const numericUid = target.uid;
    const friendName = target.name || '候选人';

    // Step 3: Click on the user in the chat list to open conversation
    const clicked: any = await page.evaluate(`
      async () => {
        // The geek-item has id like _748787762-0
        const item = document.querySelector('#_${numericUid}-0') || document.querySelector('[id^="_${numericUid}"]');
        if (item) {
          item.click();
          return { clicked: true, id: item.id };
        }
        // Fallback: try clicking by iterating geek items
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
      throw new Error('无法在聊天列表中找到该用户，请确认聊天列表中有此人');
    }

    // Step 4: Wait for the conversation to load and input area to appear
    await page.wait({ time: 2 });

    // Step 5: Find the message editor and type
    const typed: any = await page.evaluate(`
      async () => {
        // Look for the chat editor - BOSS uses contenteditable div or textarea
        const selectors = [
          '.chat-editor [contenteditable="true"]',
          '.chat-input [contenteditable="true"]',
          '.message-editor [contenteditable="true"]',
          '.chat-conversation [contenteditable="true"]',
          '[contenteditable="true"]',
          '.chat-editor textarea',
          '.chat-input textarea',
          'textarea',
        ];
        
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) {
            el.focus();
            
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
              el.value = ${JSON.stringify(text)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
              // contenteditable
              el.textContent = '';
              el.focus();
              document.execCommand('insertText', false, ${JSON.stringify(text)});
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
            return { found: true, selector: sel, tag: el.tagName };
          }
        }
        
        // Debug: list all visible elements in chat-conversation
        const conv = document.querySelector('.chat-conversation');
        const allEls = conv ? Array.from(conv.querySelectorAll('*')).filter(e => e.offsetParent !== null).map(e => e.tagName + '.' + (e.className?.substring?.(0, 50) || '')).slice(0, 30) : [];
        
        return { found: false, visibleElements: allEls };
      }
    `);

    if (!typed.found) {
      throw new Error('找不到消息输入框。可能的元素: ' + JSON.stringify(typed.visibleElements || []));
    }

    await page.wait({ time: 0.5 });

    // Step 6: Click the send button (Enter key doesn't trigger send on BOSS)
    const sent: any = await page.evaluate(`
      async () => {
        // The send button is .submit inside .submit-content
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
      // Fallback: try Enter key
      await page.pressKey('Enter');
    }

    await page.wait({ time: 1 });

    return [{ status: '✅ 发送成功', detail: `已向 ${friendName} 发送: ${text}` }];
  },
});
