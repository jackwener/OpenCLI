import { cli, Strategy } from '@jackwener/opencli/registry';
import { apiGet, payloadData, resolveUid } from './utils.js';

cli({
  site: 'bilibili',
  name: 'user-videos',
  description: '查看指定用户的投稿视频',
  domain: 'www.bilibili.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'uid', required: true, positional: true, help: 'User UID or username' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    { name: 'order', default: 'pubdate', help: 'Sort: pubdate, click, stow' },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
  ],
  columns: ['rank', 'title', 'plays', 'likes', 'date', 'url'],
  func: async (page, kwargs) => {
    const { uid: uidInput, limit = 20, order = 'pubdate', page: pageNum = 1 } = kwargs;
    const uid = await resolveUid(page, String(uidInput));

    const payload = await apiGet(page, '/x/space/wbi/arc/search', {
      params: {
        mid: uid,
        pn: pageNum,
        ps: Math.min(Number(limit), 50),
        order,
      },
      signed: true,
    });

    const vlist: any[] = payloadData(payload)?.list?.vlist ?? [];

    return vlist.slice(0, Number(limit)).map((item: any, i: number) => ({
      rank: i + 1,
      title: item.title ?? '',
      plays: item.play ?? 0,
      likes: item.like ?? 0,
      date: item.created ? new Date(item.created * 1000).toISOString().slice(0, 10) : '',
      url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '',
    }));
  },
});
