import { cli, Strategy } from '@jackwener/opencli/registry';
import { browserFetch } from './_shared/browser-fetch.js';
cli({
    site: 'douyin',
    name: 'collections',
    access: 'read',
    description: '合集列表',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 20 },
    ],
    columns: ['mix_id', 'name', 'item_count'],
    func: async (page, kwargs) => {
        const url = `https://creator.douyin.com/web/api/mix/list/?status=0,1,2,3,6&count=${kwargs.limit}&cursor=0&should_query_new_mix=1&device_platform=web&aid=1128`;
        const res = await browserFetch(page, 'GET', url);
        return (res.mix_list ?? []).map(m => ({
            mix_id: m.mix_id,
            name: m.mix_name,
            item_count: m.item_count,
        }));
    },
});
