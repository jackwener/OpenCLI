/**
 * BOSS直聘 job search — browser cookie API.
 * Source: bb-sites/boss/search.js
 */
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'boss',
  name: 'search',
  description: 'BOSS直聘搜索职位',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', required: true, help: 'Search keyword (e.g. AI agent, 前端)' },
    { name: 'city', default: '101010100', help: 'City code (101010100=北京, 101020100=上海, 101210100=杭州, 101280100=广州)' },
    { name: 'limit', type: 'int', default: 15, help: 'Number of results' },
  ],
  columns: ['name', 'salary', 'company', 'city', 'experience', 'degree', 'boss', 'url'],
  func: async (page, kwargs) => {
    await page.goto('https://www.zhipin.com');
    await page.wait(2);
    const data = await page.evaluate(`
      (async () => {
        const params = new URLSearchParams({
          scene: '1', query: '${kwargs.query.replace(/'/g, "\\'")}',
          city: '${kwargs.city || '101010100'}', page: '1', pageSize: '15',
          experience: '', degree: '', payType: '', partTime: '',
          industry: '', scale: '', stage: '', position: '',
          jobType: '', salary: '', multiBusinessDistrict: '', multiSubway: ''
        });
        const resp = await fetch('/wapi/zpgeek/search/joblist.json?' + params.toString(), {credentials: 'include'});
        if (!resp.ok) return {error: 'HTTP ' + resp.status};
        const d = await resp.json();
        if (d.code !== 0) return {error: d.message || 'API error'};
        const zpData = d.zpData || {};
        return (zpData.jobList || []).map(j => ({
          name: j.jobName, salary: j.salaryDesc, company: j.brandName,
          city: j.cityName, experience: j.jobExperience, degree: j.jobDegree,
          boss: j.bossName + ' · ' + j.bossTitle,
          url: j.encryptJobId ? 'https://www.zhipin.com/job_detail/' + j.encryptJobId + '.html' : ''
        }));
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data.slice(0, kwargs.limit || 15);
  },
});
