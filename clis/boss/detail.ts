/**
 * BOSS直聘 job detail — fetch full job posting details via browser cookie API.
 */
import { cli, Strategy } from '../../src/registry.js';
import { requirePage, navigateTo, bossFetch, verbose } from './utils.js';

cli({
  site: 'boss',
  name: 'detail',
  description: 'BOSS直聘查看职位详情',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    { name: 'security-id', positional: true, required: true, help: 'Security ID from search results (securityId field)' },
  ],
  columns: [
    'name', 'salary', 'experience', 'degree', 'city', 'district',
    'description', 'skills', 'welfare',
    'boss_name', 'boss_title', 'active_time',
    'company', 'industry', 'scale', 'stage',
    'address', 'url',
  ],
  func: async (page, kwargs) => {
    requirePage(page);

    const securityId = kwargs['security-id'];
    verbose('Fetching job detail...');

    // Navigate to zhipin.com first to establish cookie context (referrer + cookies)
    await navigateTo(page, 'https://www.zhipin.com/web/geek/job');

    const targetUrl = `https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}`;
    const data = await bossFetch(page, targetUrl);

    const zpData = data.zpData || {};
    const jobInfo = zpData.jobInfo || {};
    const bossInfo = zpData.bossInfo || {};
    const brandComInfo = zpData.brandComInfo || {};

    if (!jobInfo.jobName) {
      throw new Error('该职位信息不存在或已下架');
    }

    return [{
      name: jobInfo.jobName || '',
      salary: jobInfo.salaryDesc || '',
      experience: jobInfo.experienceName || '',
      degree: jobInfo.degreeName || '',
      city: jobInfo.locationName || '',
      district: [jobInfo.areaDistrict, jobInfo.businessDistrict].filter(Boolean).join('·'),
      description: jobInfo.postDescription || '',
      skills: (jobInfo.showSkills || []).join(', '),
      welfare: (brandComInfo.labels || []).join(', '),
      boss_name: bossInfo.name || '',
      boss_title: bossInfo.title || '',
      active_time: bossInfo.activeTimeDesc || '',
      company: brandComInfo.brandName || bossInfo.brandName || '',
      industry: brandComInfo.industryName || '',
      scale: brandComInfo.scaleName || '',
      stage: brandComInfo.stageName || '',
      address: jobInfo.address || '',
      url: jobInfo.encryptId
        ? 'https://www.zhipin.com/job_detail/' + jobInfo.encryptId + '.html'
        : '',
    }];
  },
});
