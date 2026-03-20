/**
 * BOSS直聘 invite — send interview invitation to a candidate.
 *
 * Uses POST /wapi/zpinterview/boss/interview/invite to send interview invitations.
 * Address and contact info come from the boss's saved settings.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'invite',
  description: 'BOSS直聘发送面试邀请',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'uid', required: true, help: 'Encrypted UID of the candidate' },
    { name: 'time', required: true, help: 'Interview time (e.g. 2025-04-01 14:00)' },
    { name: 'address', default: '', help: 'Interview address (uses saved address if empty)' },
    { name: 'contact', default: '', help: 'Contact person name (uses saved contact if empty)' },
  ],
  columns: ['status', 'detail'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const uid = kwargs.uid;
    const timeStr = kwargs.time;
    const address = kwargs.address;
    const contact = kwargs.contact;

    if (process.env.OPENCLI_VERBOSE) {
      console.error(`[opencli:boss] Sending interview invitation to ${uid}...`);
    }

    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 2 });

    // Get candidate info
    let friend: any = null;

    // Check greet list first
    const greetData: any = await page.evaluate(`
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

    if (greetData.code === 0) {
      friend = (greetData.zpData?.friendList || []).find((f: any) => f.encryptUid === uid);
    }

    if (!friend) {
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
        friend = (friendData.zpData?.friendList || []).find((f: any) => f.encryptUid === uid);
      }
    }

    if (!friend) {
      throw new Error('未找到该候选人');
    }

    const numericUid = friend.uid;
    const friendName = friend.name || '候选人';
    const securityId = friend.securityId || '';
    const encJobId = friend.encryptJobId || '';

    // Get saved contact info
    const contactData: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://www.zhipin.com/wapi/zpinterview/boss/interview/contactInit', true);
          xhr.withCredentials = true;
          xhr.timeout = 10000;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { reject(e); } };
          xhr.onerror = () => reject(new Error('Network Error'));
          xhr.send();
        });
      }
    `);

    const contactId = contactData.zpData?.contactId || '';
    const contactName = contact || contactData.zpData?.contactName || '';
    const contactPhone = contactData.zpData?.contactPhone || '';

    // Get saved address
    const addressData: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://www.zhipin.com/wapi/zpinterview/boss/interview/listAddress', true);
          xhr.withCredentials = true;
          xhr.timeout = 10000;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { reject(e); } };
          xhr.onerror = () => reject(new Error('Network Error'));
          xhr.send();
        });
      }
    `);

    const savedAddress = addressData.zpData?.list?.[0] || {};
    const addressText = address || savedAddress.cityAddressText || savedAddress.addressText || '';

    // Parse interview time
    const interviewTime = new Date(timeStr).getTime();
    if (isNaN(interviewTime)) {
      throw new Error(`时间格式错误: ${timeStr}，请使用格式如 2025-04-01 14:00`);
    }

    // Send interview invitation
    const params = new URLSearchParams({
      uid: String(numericUid),
      securityId: securityId,
      encryptJobId: encJobId,
      interviewTime: String(interviewTime),
      contactId: contactId,
      contactName: contactName,
      contactPhone: contactPhone,
      address: addressText,
      interviewType: '1',  // 1 = onsite
    });

    const data: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', 'https://www.zhipin.com/wapi/zpinterview/boss/interview/invite.json', true);
          xhr.withCredentials = true;
          xhr.timeout = 15000;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { reject(new Error('JSON parse failed')); } };
          xhr.onerror = () => reject(new Error('Network Error'));
          xhr.send(${JSON.stringify(params.toString())});
        });
      }
    `);

    if (data.code !== 0) {
      if (data.code === 7 || data.code === 37) {
        throw new Error('Cookie 已过期！请在当前 Chrome 浏览器中重新登录 BOSS 直聘。');
      }
      throw new Error(`面试邀请发送失败: ${data.message} (code=${data.code})`);
    }

    return [{
      status: '✅ 面试邀请已发送',
      detail: `已向 ${friendName} 发送面试邀请\n时间: ${timeStr}\n地点: ${addressText}\n联系人: ${contactName}`,
    }];
  },
});
