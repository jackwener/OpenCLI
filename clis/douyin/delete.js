import { cli, Strategy } from '@jackwener/opencli/registry';
import { browserFetch } from './_shared/browser-fetch.js';
cli({
    site: 'douyin',
    name: 'delete',
    description: '删除作品',
    domain: 'creator.douyin.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'aweme_id', required: true, positional: true, help: '作品 ID' },
    ],
    columns: ['status'],
    func: async (page, kwargs) => {
        const url = 'https://creator.douyin.com/web/api/media/aweme/delete/?aid=1128';
        await browserFetch(page, 'POST', url, { body: { aweme_id: kwargs.aweme_id } });
        return [{ status: `✅ 已删除 ${kwargs.aweme_id}` }];
    },
});
