/**
 * BOSS直聘 recommend — view recommended candidates (新招呼/greet sort list).
 *
 * Uses /wapi/zprelation/friend/greetRecSortList to get system-recommended candidates.
 * These are candidates who have greeted or been recommended by the system.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'recommend',
  description: 'BOSS直聘查看推荐候选人（新招呼列表）',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of results to return' },
  ],
  columns: ['name', 'job_name', 'last_time', 'labels', 'encrypt_uid', 'security_id', 'encrypt_job_id'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const limit = kwargs.limit || 20;

    if (process.env.OPENCLI_VERBOSE) {
      console.error('[opencli:boss] Fetching recommended candidates...');
    }

    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 2 });

    // Get label definitions for mapping
    const labelData: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://www.zhipin.com/wapi/zprelation/friend/label/get', true);
          xhr.withCredentials = true;
          xhr.timeout = 10000;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { resolve({}); } };
          xhr.onerror = () => resolve({});
          xhr.send();
        });
      }
    `);

    const labelMap: Record<number, string> = {};
    if (labelData.code === 0 && labelData.zpData?.labels) {
      for (const l of labelData.zpData.labels) {
        labelMap[l.labelId] = l.label;
      }
    }

    // Get recommended candidates
    const targetUrl = 'https://www.zhipin.com/wapi/zprelation/friend/greetRecSortList';

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
          xhr.ontimeout = () => reject(new Error('Timeout'));
          xhr.send();
        });
      }
    `);

    if (data.code !== 0) {
      if (data.code === 7 || data.code === 37) {
        throw new Error('Cookie 已过期！请在当前 Chrome 浏览器中重新登录 BOSS 直聘。');
      }
      throw new Error(`API error: ${data.message} (code=${data.code})`);
    }

    const friends = (data.zpData?.friendList || []).slice(0, limit);

    return friends.map((f: any) => ({
      name: f.name || '',
      job_name: f.jobName || '',
      last_time: f.lastTime || '',
      labels: (f.relationLabelList || []).map((id: number) => labelMap[id] || String(id)).join(', '),
      encrypt_uid: f.encryptUid || '',
      security_id: f.securityId || '',
      encrypt_job_id: f.encryptJobId || '',
    }));
  },
});
