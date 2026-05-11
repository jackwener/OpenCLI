import { cli, Strategy } from '@jackwener/opencli/registry';
import { apiGet } from './utils.js';
cli({
    site: 'bilibili',
    name: 'dynamic',
    access: 'read',
    description: 'Get Bilibili user dynamic feed',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 15 },
    ],
    columns: ['id', 'author', 'text', 'likes', 'url'],
    func: async (page, kwargs) => {
        const payload = await apiGet(page, '/x/polymer/web-dynamic/v1/feed/all', { params: {}, signed: false });
        const results = payload?.data?.items ?? [];
        return results.slice(0, Number(kwargs.limit)).map((item) => {
            let text = '';
            if (item.modules?.module_dynamic?.desc?.text) {
                text = item.modules.module_dynamic.desc.text;
            }
            else if (item.modules?.module_dynamic?.major?.archive?.title) {
                text = item.modules.module_dynamic.major.archive.title;
            }
            return {
                id: item.id_str ?? '',
                author: item.modules?.module_author?.name ?? '',
                text: text,
                likes: item.modules?.module_stat?.like?.count ?? 0,
                url: item.id_str ? `https://t.bilibili.com/${item.id_str}` : ''
            };
        });
    },
});
