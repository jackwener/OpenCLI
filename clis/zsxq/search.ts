import { cli, Strategy } from '../../src/registry.js';
import {
  getActiveGroupId,
  ensureZsxqAuth,
  ensureZsxqPage,
  fetchFirstJson,
  getGroupsFromResponse,
  getTopicsFromResponse,
  toTopicRow,
} from './utils.js';

cli({
  site: 'zsxq',
  name: 'search',
  description: '搜索星球内容',
  domain: 'wx.zsxq.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'keyword', required: true, positional: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results to return' },
    { name: 'group_id', help: 'Optional group id; defaults to the active group in Chrome' },
  ],
  columns: ['topic_id', 'group', 'author', 'title', 'comments', 'likes', 'time', 'url'],
  func: async (page, kwargs) => {
    await ensureZsxqPage(page);
    await ensureZsxqAuth(page);

    const keyword = String(kwargs.keyword || '').trim();
    const limit = Math.max(1, Number(kwargs.limit) || 20);
    const groupId = String(kwargs.group_id || await getActiveGroupId(page));
    const query = encodeURIComponent(keyword);

    // Resolve group name from groups API
    let groupName = groupId;
    try {
      const { data: groupsData } = await fetchFirstJson(page, [
        `https://api.zsxq.com/v2/groups`,
      ]);
      const groups = getGroupsFromResponse(groupsData);
      const found = groups.find(g => String(g.group_id) === groupId);
      if (found?.name) groupName = found.name;
    } catch { /* ignore */ }

    const { data } = await fetchFirstJson(page, [
      `https://api.zsxq.com/v2/search/groups/${groupId}/topics?keyword=${query}&count=${limit}`,
    ]);

    return getTopicsFromResponse(data).slice(0, limit).map((topic) => ({
      ...toTopicRow(topic),
      group: groupName,
    }));
  },
});
