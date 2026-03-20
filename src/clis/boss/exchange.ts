/**
 * BOSS直聘 exchange — request phone/wechat exchange with a candidate.
 *
 * Uses POST /wapi/zpchat/exchange/request to send an exchange request.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'exchange',
  description: 'BOSS直聘交换联系方式（请求手机/微信）',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'uid', required: true, help: 'Encrypted UID of the candidate' },
    { name: 'type', default: 'phone', choices: ['phone', 'wechat'], help: 'Exchange type: phone or wechat' },
  ],
  columns: ['status', 'detail'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const uid = kwargs.uid;
    const exchangeType = kwargs.type || 'phone';

    if (process.env.OPENCLI_VERBOSE) {
      console.error(`[opencli:boss] Requesting ${exchangeType} exchange for ${uid}...`);
    }

    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 2 });

    // Find candidate
    let friend: any = null;

    // Check greet list
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

    // type mapping from JS source: 1=phone, 2=wechat, 4=resume
    const typeId = exchangeType === 'wechat' ? 2 : 1;

    // Params from JS: {type, securityId, uniqueId, name}
    const params = new URLSearchParams({
      type: String(typeId),
      securityId: securityId,
      uniqueId: String(numericUid),
      name: friendName,
    });

    // POST with form-urlencoded (discovered from 336.js bundle)
    const data: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', 'https://www.zhipin.com/wapi/zpchat/exchange/request', true);
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
      throw new Error(`交换请求失败: ${data.message} (code=${data.code})`);
    }

    const typeLabel = exchangeType === 'wechat' ? '微信' : '手机号';
    return [{
      status: '✅ 交换请求已发送',
      detail: `已向 ${friendName} 发送${typeLabel}交换请求`,
    }];
  },
});
