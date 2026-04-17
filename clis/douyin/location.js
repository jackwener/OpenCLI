import { cli, Strategy } from '@jackwener/opencli/registry';
import { browserFetch } from './_shared/browser-fetch.js';
cli({
    site: 'douyin',
    name: 'location',
    description: '地理位置 POI 搜索',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'query', required: true, positional: true, help: '地名关键词' },
        { name: 'limit', type: 'int', default: 20 },
    ],
    columns: ['poi_id', 'name', 'address', 'city'],
    func: async (page, kwargs) => {
        const url = `https://creator.douyin.com/aweme/v1/life/video_api/search/poi/?keyword=${encodeURIComponent(kwargs.query)}&count=${kwargs.limit}&aid=1128`;
        const res = await browserFetch(page, 'GET', url);
        return (res.poi_list ?? []).map(p => ({
            poi_id: p.poi_id,
            name: p.poi_name,
            address: p.address,
            city: p.city_name,
        }));
    },
});
