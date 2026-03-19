import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'chatmsg',
  description: 'BOSS直聘查看与候选人的聊天消息',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'uid', required: true, help: 'Encrypted UID (from chatlist)' },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
  ],
  columns: ['from', 'type', 'text', 'time'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');
    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 2 });
    const uid = kwargs.uid;
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
    if (friendData.code !== 0) throw new Error('获取好友列表失败');
    const friend = (friendData.zpData?.friendList || []).find((f: any) => f.encryptUid === uid);
    if (!friend) throw new Error('未找到该候选人');
    const gid = friend.uid;
    const securityId = encodeURIComponent(friend.securityId);
    const msgUrl = `https://www.zhipin.com/wapi/zpchat/boss/historyMsg?gid=${gid}&securityId=${securityId}&page=${kwargs.page}&c=20&src=0`;
    const msgData: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '${msgUrl}', true);
          xhr.withCredentials = true;
          xhr.timeout = 15000;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { resolve({raw: xhr.responseText.substring(0,500)}); } };
          xhr.onerror = () => reject(new Error('Network Error'));
          xhr.send();
        });
      }
    `);
    if (msgData.raw) throw new Error('Non-JSON: ' + msgData.raw);
    if (msgData.code !== 0) throw new Error('API error: ' + (msgData.message || msgData.code));
    const TYPE_MAP: Record<number, string> = {1: '文本', 2: '图片', 3: '招呼', 4: '简历', 5: '系统', 6: '名片', 7: '语音', 8: '视频', 9: '表情'};
    const messages = msgData.zpData?.messages || msgData.zpData?.historyMsgList || [];
    return messages.map((m: any) => {
      const fromObj = m.from || {};
      const isSelf = typeof fromObj === 'object' ? fromObj.uid !== friend.uid : false;
      return {
        from: isSelf ? '我' : (typeof fromObj === 'object' ? fromObj.name : friend.name),
        type: TYPE_MAP[m.type] || '其他(' + m.type + ')',
        text: m.text || m.body?.text || '',
        time: m.time ? new Date(m.time).toLocaleString('zh-CN') : '',
      };
    });
  },
});
