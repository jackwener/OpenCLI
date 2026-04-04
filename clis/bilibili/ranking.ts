import { cli, Strategy } from '../../src/registry.js';
import { apiGet } from './utils.js';

cli({
  site: 'bilibili',
  name: 'ranking',
  description: 'Get Bilibili video ranking board',
  domain: 'www.bilibili.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'title', 'author', 'score', 'url'],
  func: async (page, kwargs) => {
    const payload = await apiGet(page, '/x/web-interface/ranking/v2', { params: { rid: 0, type: 'all' }, signed: false });
    const results: any[] = payload?.data?.list ?? [];
    return results.slice(0, Number(kwargs.limit)).map((item: any, i: number) => ({
      rank: i + 1,
      title: item.title ?? '',
      author: item.owner?.name ?? '',
      score: item.stat?.view ?? 0,
      url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : ''
    }));
  },
});
