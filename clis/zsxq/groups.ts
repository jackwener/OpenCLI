import { cli, Strategy } from '../../registry.js';
import {
  ensureZsxqAuth,
  ensureZsxqPage,
  fetchFirstJson,
  getGroupsFromResponse,
} from './utils.js';

cli({
  site: 'zsxq',
  name: 'groups',
  description: '列出当前账号加入的星球',
  domain: 'wx.zsxq.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 50, help: 'Number of groups to return' },
  ],
  columns: ['group_id', 'name', 'category', 'members', 'topics', 'joined_at', 'url'],
  func: async (page, kwargs) => {
    await ensureZsxqPage(page);
    await ensureZsxqAuth(page);

    const limit = Math.max(1, Number(kwargs.limit) || 50);

    const { data } = await fetchFirstJson(page, [
      `https://api.zsxq.com/v2/groups`,
    ]);

    return getGroupsFromResponse(data).slice(0, limit).map((group) => ({
      group_id: group.group_id ?? '',
      name: group.name || '',
      category: group.category?.title || '',
      members: group.statistics?.subscriptions_count ?? 0,
      topics: group.statistics?.topics_count ?? 0,
      joined_at: group.user_specific?.join_time || '',
      valid_until: group.user_specific?.validity?.end_time || '',
      url: group.group_id ? `https://wx.zsxq.com/group/${group.group_id}` : 'https://wx.zsxq.com',
    }));
  },
});
