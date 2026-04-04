/**
 * BOSS直聘 recommend — view recommended candidates (新招呼/greet sort list).
 */
import { cli, Strategy } from '../../src/registry.js';
import { requirePage, navigateToChat, bossFetch, fetchRecommendList, verbose } from './utils.js';

cli({
  site: 'boss',
  name: 'recommend',
  description: 'BOSS直聘查看推荐候选人（新招呼列表）',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of results to return' },
  ],
  columns: ['name', 'job_name', 'last_time', 'labels', 'encrypt_uid', 'security_id', 'encrypt_job_id'],
  func: async (page, kwargs) => {
    requirePage(page);
    verbose('Fetching recommended candidates...');

    await navigateToChat(page);

    // Get label definitions for mapping
    const labelData = await bossFetch(page, 'https://www.zhipin.com/wapi/zprelation/friend/label/get', {
      allowNonZero: true,
    });
    const labelMap: Record<number, string> = {};
    if (labelData.code === 0 && labelData.zpData?.labels) {
      for (const l of labelData.zpData.labels) {
        labelMap[l.labelId] = l.label;
      }
    }

    const friends = await fetchRecommendList(page);
    const limit = kwargs.limit || 20;

    return friends.slice(0, limit).map((f: any) => ({
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
