import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'chatlist',
  description: 'BOSS直聘查看聊天列表（招聘端）',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    { name: 'job_id', default: '0', help: 'Filter by job ID (0=all)' },
  ],
  columns: ['name', 'job', 'last_msg', 'last_time', 'uid', 'security_id'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');
    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 2 });
    const jobId = kwargs.job_id || '0';
    const pageNum = kwargs.page || 1;
    const limit = kwargs.limit || 20;
    const targetUrl = `https://www.zhipin.com/wapi/zprelation/friend/getBossFriendListV2.json?page=${pageNum}&status=0&jobId=${jobId}`;
    const data: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '${targetUrl}', true);
          xhr.withCredentials = true;
          xhr.timeout = 15000;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { reject(new Error('JSON parse failed')); } };
          xhr.onerror = () => reject(new Error('Network Error'));
          xhr.send();
        });
      }
    `);
    if (data.code !== 0) throw new Error(`API error: ${data.message} (code=${data.code})`);
    const friends = (data.zpData?.friendList || []).slice(0, limit);
    return friends.map((f: any) => ({
      name: f.name || '',
      job: f.jobName || '',
      last_msg: f.lastMessageInfo?.text || '',
      last_time: f.lastTime || '',
      uid: f.encryptUid || '',
      security_id: f.securityId || '',
    }));
  },
});
