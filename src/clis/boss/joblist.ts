/**
 * BOSS直聘 job list — list my published jobs via boss API.
 *
 * Uses /wapi/zpjob/job/chatted/jobList to get job list with status info.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'joblist',
  description: 'BOSS直聘查看我发布的职位列表',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  columns: ['job_name', 'salary', 'city', 'status', 'encrypt_job_id'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    if (process.env.OPENCLI_VERBOSE) {
      console.error('[opencli:boss] Fetching job list...');
    }

    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 2 });

    const targetUrl = 'https://www.zhipin.com/wapi/zpjob/job/chatted/jobList';

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

    const jobs = data.zpData || [];

    return jobs.map((j: any) => ({
      job_name: j.jobName || '',
      salary: j.salaryDesc || '',
      city: j.address || '',
      status: j.jobOnlineStatus === 1 ? '在线' : '已关闭',
      encrypt_job_id: j.encryptJobId || '',
    }));
  },
});
