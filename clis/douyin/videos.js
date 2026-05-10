import { cli, Strategy } from '@jackwener/opencli/registry';
import { browserFetch } from './_shared/browser-fetch.js';
function normalizeVideoStatus(status, publicTime) {
    if (typeof status === 'number')
        return status;
    if (!status)
        return publicTime && publicTime > Date.now() / 1000 ? 'scheduled' : 'published';
    if (status.is_delete)
        return 'deleted';
    if (status.is_prohibited)
        return 'prohibited';
    if (status.in_reviewing)
        return 'reviewing';
    if (status.is_private)
        return 'private';
    if (publicTime && publicTime > Date.now() / 1000)
        return 'scheduled';
    return 'published';
}
cli({
    site: 'douyin',
    name: 'videos',
    access: 'read',
    description: '获取作品列表',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 20, help: '每页数量' },
        { name: 'page', type: 'int', default: 1, help: '页码' },
        { name: 'status', default: 'all', choices: ['all', 'published', 'reviewing', 'scheduled'] },
    ],
    columns: ['aweme_id', 'title', 'status', 'play_count', 'digg_count', 'create_time'],
    func: async (page, kwargs) => {
        const statusMap = { all: 0, published: 1, reviewing: 3, scheduled: 0 };
        const statusNum = statusMap[kwargs.status] ?? 0;
        const url = `https://creator.douyin.com/janus/douyin/creator/pc/work_list?page_size=${kwargs.limit}&page_num=${kwargs.page}&status=${statusNum}`;
        const res = (await browserFetch(page, 'GET', url));
        let items = res.data?.work_list ?? res.aweme_list ?? [];
        // The API has a bug with status=16 for scheduled, so filter client-side
        if (kwargs.status === 'scheduled') {
            items = items.filter((v) => (v.public_time ?? 0) > Date.now() / 1000);
        }
        return items.map((v) => ({
            aweme_id: v.aweme_id,
            title: v.desc ?? '',
            status: normalizeVideoStatus(v.status, v.public_time),
            play_count: v.statistics?.play_count ?? 0,
            digg_count: v.statistics?.digg_count ?? 0,
            create_time: new Date((v.create_time ?? v.public_time ?? 0) * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' }),
        }));
    },
});
