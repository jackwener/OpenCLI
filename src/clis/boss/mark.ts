/**
 * BOSS直聘 mark — label/mark a candidate.
 *
 * Uses /wapi/zprelation/friend/label/addMark to add a label to a candidate,
 * and /wapi/zprelation/friend/label/deleteMark to remove one.
 *
 * Available labels (from /wapi/zprelation/friend/label/get):
 *   1=新招呼, 2=沟通中, 3=已约面, 4=已获取简历, 5=已交换电话,
 *   6=已交换微信, 7=不合适, 8=牛人发起, 11=收藏
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

const LABEL_MAP: Record<string, number> = {
  '新招呼': 1, '沟通中': 2, '已约面': 3, '已获取简历': 4,
  '已交换电话': 5, '已交换微信': 6, '不合适': 7, '牛人发起': 8, '收藏': 11,
};

cli({
  site: 'boss',
  name: 'mark',
  description: 'BOSS直聘给候选人添加标签',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'uid', required: true, help: 'Encrypted UID of the candidate' },
    { name: 'label', required: true, help: 'Label name (新招呼/沟通中/已约面/已获取简历/已交换电话/已交换微信/不合适/收藏) or label ID' },
    { name: 'remove', type: 'boolean', default: false, help: 'Remove the label instead of adding' },
  ],
  columns: ['status', 'detail'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const uid = kwargs.uid;
    const labelInput = kwargs.label;
    const remove = kwargs.remove || false;

    // Resolve label to ID
    let labelId: number;
    if (LABEL_MAP[labelInput]) {
      labelId = LABEL_MAP[labelInput];
    } else if (!isNaN(Number(labelInput))) {
      labelId = Number(labelInput);
    } else {
      // Try partial match
      const entry = Object.entries(LABEL_MAP).find(([k]) => k.includes(labelInput));
      if (entry) {
        labelId = entry[1];
      } else {
        throw new Error(`未知标签: ${labelInput}。可用标签: ${Object.keys(LABEL_MAP).join(', ')}`);
      }
    }

    if (process.env.OPENCLI_VERBOSE) {
      console.error(`[opencli:boss] ${remove ? 'Removing' : 'Adding'} label ${labelId} for ${uid}...`);
    }

    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 2 });

    // First get numeric UID from friend list
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
      throw new Error(`获取好友列表失败: ${friendData.message}`);
    }

    // Find in friend list (check multiple pages)
    let friend: any = null;
    let allFriends = friendData.zpData?.friendList || [];
    friend = allFriends.find((f: any) => f.encryptUid === uid);

    if (!friend) {
      // Also check greetRecSortList
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
    }

    if (!friend) {
      throw new Error('未找到该候选人');
    }

    const numericUid = friend.uid;
    const friendName = friend.name || '候选人';
    const friendSource = friend.friendSource ?? 0;

    const action = remove ? 'deleteMark' : 'addMark';
    const targetUrl = `https://www.zhipin.com/wapi/zprelation/friend/label/${action}`;

    // The API uses friendId + friendSource + labelId (discovered from JS bundles)
    const params = new URLSearchParams({
      friendId: String(numericUid),
      friendSource: String(friendSource),
      labelId: String(labelId),
    });

    // Try GET first (the N() wrapper in boss JS uses GET with query params)
    const data: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '${targetUrl}?${params.toString()}', true);
          xhr.withCredentials = true;
          xhr.timeout = 15000;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { reject(new Error('JSON parse failed')); } };
          xhr.onerror = () => reject(new Error('Network Error'));
          xhr.send();
        });
      }
    `);

    if (data.code !== 0) {
      throw new Error(`标签操作失败: ${data.message} (code=${data.code})`);
    }

    const labelName = Object.entries(LABEL_MAP).find(([, v]) => v === labelId)?.[0] || String(labelId);
    return [{
      status: remove ? '✅ 标签已移除' : '✅ 标签已添加',
      detail: `${friendName}: ${remove ? '移除' : '添加'}标签「${labelName}」`,
    }];
  },
});
