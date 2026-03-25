import { cli, Strategy } from '../../registry.js';
import { browserFetch } from './_shared/browser-fetch.js';

cli({
  site: 'douyin',
  name: 'activities',
  description: '官方活动列表',
  domain: 'creator.douyin.com',
  strategy: Strategy.COOKIE,
  args: [],
  columns: ['activity_id', 'title', 'end_time'],
  func: async (page, _kwargs) => {
    const url = 'https://creator.douyin.com/web/api/media/activity/get/?aid=1128';
    const res = await browserFetch(page, 'GET', url) as {
      activity_list: Array<{ activity_id: string; title: string; end_time: number }>
    };
    return (res.activity_list ?? []).map(a => ({
      activity_id: a.activity_id,
      title: a.title,
      end_time: new Date(a.end_time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' }),
    }));
  },
});
