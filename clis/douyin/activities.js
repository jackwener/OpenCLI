import { cli, Strategy } from '@jackwener/opencli/registry';
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
        const res = await browserFetch(page, 'GET', url);
        return (res.activity_list ?? []).map(a => ({
            activity_id: a.activity_id,
            title: a.title ?? a.activity_name ?? '',
            end_time: typeof a.end_time === 'number'
                ? new Date(a.end_time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' })
                : (a.show_end_time ?? ''),
        }));
    },
});
