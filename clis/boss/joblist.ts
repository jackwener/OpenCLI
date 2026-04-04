/**
 * BOSS直聘 job list — list my published jobs via boss API.
 */
import { cli, Strategy } from '../../src/registry.js';
import { requirePage, navigateToChat, bossFetch, verbose } from './utils.js';

cli({
  site: 'boss',
  name: 'joblist',
  description: 'BOSS直聘查看我发布的职位列表',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [],
  columns: ['job_name', 'salary', 'city', 'status', 'encrypt_job_id'],
  func: async (page, kwargs) => {
    requirePage(page);
    verbose('Fetching job list...');

    await navigateToChat(page);

    const data = await bossFetch(page, 'https://www.zhipin.com/wapi/zpjob/job/chatted/jobList');

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
