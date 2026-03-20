/**
 * BOSS直聘 stats — job statistics overview.
 *
 * Uses /wapi/zpchat/chatHelper/statistics for total friend count,
 * and /wapi/zpjob/job/chatted/jobList for per-job info.
 * Since BOSS doesn't expose detailed per-job stats via API,
 * we show what's available: job status, chat info, and total stats.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'stats',
  description: 'BOSS直聘职位数据统计',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'job_id', default: '', help: 'Encrypted job ID (show all if empty)' },
  ],
  columns: ['job_name', 'salary', 'city', 'status', 'total_chats', 'encrypt_job_id'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const filterJobId = kwargs.job_id || '';

    if (process.env.OPENCLI_VERBOSE) {
      console.error('[opencli:boss] Fetching job statistics...');
    }

    await page.goto('https://www.zhipin.com/web/chat/index');
    await page.wait({ time: 2 });

    // Get job list
    const jobData: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://www.zhipin.com/wapi/zpjob/job/chatted/jobList', true);
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

    if (jobData.code !== 0) {
      if (jobData.code === 7 || jobData.code === 37) {
        throw new Error('Cookie 已过期！请在当前 Chrome 浏览器中重新登录 BOSS 直聘。');
      }
      throw new Error(`API error: ${jobData.message} (code=${jobData.code})`);
    }

    // Get total chat stats
    const chatStats: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://www.zhipin.com/wapi/zpchat/chatHelper/statistics', true);
          xhr.withCredentials = true;
          xhr.timeout = 10000;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { resolve({}); } };
          xhr.onerror = () => resolve({});
          xhr.send();
        });
      }
    `);

    const totalFriends = chatStats.zpData?.totalFriendCount || 0;

    // Get per-job chat counts from friend list
    const friendData: any = await page.evaluate(`
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', 'https://www.zhipin.com/wapi/zprelation/friend/getBossFriendListV2.json?page=1&status=0&jobId=0', true);
          xhr.withCredentials = true;
          xhr.timeout = 15000;
          xhr.setRequestHeader('Accept', 'application/json');
          xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch(e) { resolve({}); } };
          xhr.onerror = () => resolve({});
          xhr.send();
        });
      }
    `);

    // Count chats per job
    const jobChatCounts: Record<string, number> = {};
    if (friendData.code === 0) {
      for (const f of (friendData.zpData?.friendList || [])) {
        const jobName = f.jobName || 'unknown';
        jobChatCounts[jobName] = (jobChatCounts[jobName] || 0) + 1;
      }
    }

    let jobs = jobData.zpData || [];
    if (filterJobId) {
      jobs = jobs.filter((j: any) => j.encryptJobId === filterJobId);
    }

    const results = jobs.map((j: any) => ({
      job_name: j.jobName || '',
      salary: j.salaryDesc || '',
      city: j.address || '',
      status: j.jobOnlineStatus === 1 ? '在线' : '已关闭',
      total_chats: String(jobChatCounts[j.jobName] || 0),
      encrypt_job_id: j.encryptJobId || '',
    }));

    // Add summary row
    if (!filterJobId && results.length > 0) {
      results.push({
        job_name: '--- 总计 ---',
        salary: '',
        city: '',
        status: `${jobs.length} 个职位`,
        total_chats: String(totalFriends),
        encrypt_job_id: '',
      });
    }

    return results;
  },
});
