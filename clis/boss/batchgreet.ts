/**
 * BOSS直聘 batchgreet — batch greet recommended candidates.
 */
import { cli, Strategy } from '../../registry.js';
import {
  requirePage, navigateToChat, fetchRecommendList,
  clickCandidateInList, typeAndSendMessage, verbose,
} from './utils.js';

cli({
  site: 'boss',
  name: 'batchgreet',
  description: 'BOSS直聘批量向推荐候选人发送招呼',
  domain: 'www.zhipin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  browser: true,
  args: [
    { name: 'job-id', default: '', help: 'Filter by encrypted job ID (greet all jobs if empty)' },
    { name: 'limit', type: 'int', default: 5, help: 'Max candidates to greet' },
    { name: 'text', default: '', help: 'Custom greeting message (uses default if empty)' },
  ],
  columns: ['name', 'status', 'detail'],
  func: async (page, kwargs) => {
    requirePage(page);

    const filterJobId = kwargs['job-id'] || '';
    const limit = kwargs.limit || 5;
    const text = kwargs.text || '你好，请问您对这个职位感兴趣吗？';

    verbose(`Batch greeting up to ${limit} candidates...`);

    await navigateToChat(page, 3);

    let candidates = await fetchRecommendList(page);
    if (filterJobId) {
      candidates = candidates.filter((f: any) => f.encryptJobId === filterJobId);
    }
    candidates = candidates.slice(0, limit);

    if (candidates.length === 0) {
      return [{ name: '-', status: '⚠️ 无候选人', detail: '当前没有待招呼的推荐候选人' }];
    }

    const results: any[] = [];

    for (const candidate of candidates) {
      const numericUid = candidate.uid;
      const friendName = candidate.name || '候选人';

      try {
        const clicked = await clickCandidateInList(page, numericUid);
        if (!clicked) {
          results.push({ name: friendName, status: '❌ 跳过', detail: '在聊天列表中未找到' });
          continue;
        }

        await page.wait({ time: 2 });

        const sent = await typeAndSendMessage(page, text);
        if (!sent) {
          results.push({ name: friendName, status: '❌ 失败', detail: '找不到消息输入框' });
          continue;
        }

        await page.wait({ time: 1.5 });
        results.push({ name: friendName, status: '✅ 已发送', detail: text });
      } catch (e: any) {
        results.push({ name: friendName, status: '❌ 失败', detail: e.message?.substring(0, 80) || '未知错误' });
      }
    }

    return results;
  },
});
