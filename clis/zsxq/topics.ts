import { cli, Strategy } from '../../src/registry.js';
import {
  getActiveGroupId,
  ensureZsxqAuth,
  ensureZsxqPage,
  fetchFirstJson,
  getTopicsFromResponse,
  toTopicRow,
} from './utils.js';

cli({
  site: 'zsxq',
  name: 'topics',
  description: '获取当前星球的话题列表',
  domain: 'wx.zsxq.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of topics to return' },
    { name: 'group_id', help: 'Optional group id; defaults to the active group in Chrome' },
  ],
  columns: ['topic_id', 'type', 'author', 'title', 'comments', 'likes', 'time', 'url'],
  func: async (page, kwargs) => {
    await ensureZsxqPage(page);
    await ensureZsxqAuth(page);

    const limit = Math.max(1, Number(kwargs.limit) || 20);
    const groupId = String(kwargs.group_id || await getActiveGroupId(page));

    const { data } = await fetchFirstJson(page, [
      `https://api.zsxq.com/v2/groups/${groupId}/topics?scope=all&count=${limit}`,
    ]);

    return getTopicsFromResponse(data).slice(0, limit).map(toTopicRow);
  },
});
