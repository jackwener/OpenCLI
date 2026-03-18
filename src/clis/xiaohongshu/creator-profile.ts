/**
 * Xiaohongshu Creator Profile — creator account info and growth status.
 *
 * Uses the creator.xiaohongshu.com internal API (cookie auth).
 * Returns follower/following counts, total likes+collects, and
 * creator level growth info.
 *
 * Requires: logged into creator.xiaohongshu.com in Chrome.
 */

import { cli, Strategy } from '../../registry.js';

cli({
  site: 'xiaohongshu',
  name: 'creator-profile',
  description: '小红书创作者账号信息 (粉丝/关注/获赞/成长等级)',
  domain: 'creator.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  columns: ['field', 'value'],
  func: async (page, _kwargs) => {
    await page.goto('https://creator.xiaohongshu.com/new/home');
    await page.wait(3);

    const data = await page.evaluate(`
      async () => {
        try {
          const resp = await fetch('/api/galaxy/creator/home/personal_info', {
            credentials: 'include',
          });
          if (!resp.ok) return { error: 'HTTP ' + resp.status };
          return await resp.json();
        } catch (e) {
          return { error: e.message };
        }
      }
    `);

    if (data?.error) {
      throw new Error(data.error + '. Are you logged into creator.xiaohongshu.com?');
    }
    if (!data?.data) {
      throw new Error('Unexpected response structure');
    }

    const d = data.data;
    const grow = d.grow_info || {};

    return [
      { field: 'Name', value: d.name ?? '' },
      { field: 'Followers', value: d.fans_count ?? 0 },
      { field: 'Following', value: d.follow_count ?? 0 },
      { field: 'Likes & Collects', value: d.faved_count ?? 0 },
      { field: 'Creator Level', value: grow.level ?? 0 },
      { field: 'Level Progress', value: `${grow.fans_count ?? 0}/${grow.max_fans_count ?? 0} fans` },
      { field: 'Bio', value: (d.personal_desc ?? '').replace(/\\n/g, ' | ') },
    ];
  },
});
