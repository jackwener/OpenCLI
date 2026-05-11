import { cli, Strategy } from '@jackwener/opencli/registry';
import { browserFetch } from './_shared/browser-fetch.js';
cli({
    site: 'douyin',
    name: 'drafts',
    access: 'read',
    description: '获取草稿列表',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 20 },
    ],
    columns: ['aweme_id', 'title', 'create_time'],
    func: async (page, kwargs) => {
        const url = 'https://creator.douyin.com/web/api/media/aweme/draft/?aid=1128';
        const res = (await browserFetch(page, 'GET', url));
        const items = (res.aweme_list ?? []).slice(0, kwargs.limit);
        return items.map((v) => ({
            aweme_id: v.aweme_id,
            title: v.desc,
            create_time: new Date(v.create_time * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' }),
        }));
    },
});
