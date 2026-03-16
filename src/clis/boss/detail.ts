/**
 * BOSS直聘 job detail — fetch full job posting details via browser cookie API.
 *
 * Uses securityId from search results to call the detail API.
 * Returns: job description, skills, welfare, boss info, company info, address.
 */
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'boss',
  name: 'detail',
  description: 'BOSS直聘查看职位详情',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,

  browser: true,
  args: [
    { name: 'security_id', required: true, help: 'Security ID from search results (securityId field)' },
  ],
  columns: [
    'name', 'salary', 'experience', 'degree', 'city', 'district',
    'description', 'skills', 'welfare',
    'boss_name', 'boss_title', 'active_time',
    'company', 'industry', 'scale', 'stage',
    'address', 'url',
  ],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

    const securityId = kwargs.security_id;

    // Navigate to zhipin.com first to establish cookie context
    await page.goto('https://www.zhipin.com/web/geek/job');
    await new Promise(r => setTimeout(r, 1000));

    const targetUrl = `https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=${encodeURIComponent(securityId)}`;

    if (process.env.OPENCLI_VERBOSE || process.env.DEBUG?.includes('opencli')) {
      console.error(`[opencli:boss] Fetching job detail...`);
    }

    const evaluateScript = `
      async () => {
        return new Promise((resolve, reject) => {
          const xhr = new window.XMLHttpRequest();
          xhr.open('GET', '${targetUrl}', true);
          xhr.withCredentials = true;
          xhr.timeout = 15000;
          xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch (e) {
                reject(new Error('Failed to parse JSON. Raw (200 chars): ' + xhr.responseText.substring(0, 200)));
              }
            } else {
              reject(new Error('XHR HTTP Status: ' + xhr.status));
            }
          };
          xhr.onerror = () => reject(new Error('XHR Network Error'));
          xhr.ontimeout = () => reject(new Error('XHR Timeout'));
          xhr.send();
        });
      }
    `;

    let data: any;
    try {
      data = await page.evaluate(evaluateScript);
    } catch (e: any) {
      throw new Error('API evaluate failed: ' + e.message);
    }

    if (data.code !== 0) {
      if (data.code === 37) {
        throw new Error('Cookie 已过期！请在当前 Chrome 浏览器中重新登录 BOSS 直聘。');
      }
      throw new Error(`BOSS API error: ${data.message || 'Unknown'} (code=${data.code})`);
    }

    const zpData = data.zpData || {};
    const jobInfo = zpData.jobInfo || {};
    const bossInfo = zpData.bossInfo || {};
    const brandComInfo = zpData.brandComInfo || {};
    const atsOnlineApplyInfo = zpData.atsOnlineApplyInfo || {};

    return [{
      name: jobInfo.jobName || '',
      salary: jobInfo.salaryDesc || '',
      experience: jobInfo.jobExperience || '',
      degree: jobInfo.jobDegree || '',
      city: jobInfo.cityName || '',
      district: [jobInfo.areaDistrict, jobInfo.businessDistrict].filter(Boolean).join('/'),
      description: jobInfo.postDescription || '',
      skills: (jobInfo.showSkills || jobInfo.skills || []).join(', '),
      welfare: (jobInfo.welfareList || []).join(', '),
      boss_name: bossInfo.name || bossInfo.bossName || '',
      boss_title: bossInfo.title || bossInfo.bossTitle || '',
      active_time: bossInfo.activeTimeDesc || '',
      company: brandComInfo.brandName || jobInfo.brandName || '',
      industry: brandComInfo.industryName || '',
      scale: brandComInfo.scaleName || '',
      stage: brandComInfo.stageName || '',
      address: jobInfo.address || '',
      url: jobInfo.encryptJobId
        ? 'https://www.zhipin.com/job_detail/' + jobInfo.encryptJobId + '.html'
        : '',
    }];
  },
});
