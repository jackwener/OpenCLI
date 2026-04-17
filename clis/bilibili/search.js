import { cli, Strategy } from '@jackwener/opencli/registry';
import { apiGet, stripHtml } from './utils.js';
cli({
    site: 'bilibili', name: 'search', description: 'Search Bilibili videos or users', domain: 'www.bilibili.com', strategy: Strategy.COOKIE,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword' },
        { name: 'type', default: 'video', help: 'video or user' },
        { name: 'page', type: 'int', default: 1, help: 'Result page' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'author', 'score', 'url'],
    func: async (page, kwargs) => {
        const { query: keyword, type = 'video', page: pageNum = 1, limit = 20 } = kwargs;
        const searchType = type === 'user' ? 'bili_user' : 'video';
        const payload = await apiGet(page, '/x/web-interface/wbi/search/type', { params: { search_type: searchType, keyword, page: pageNum }, signed: true });
        const results = payload?.data?.result ?? [];
        return results.slice(0, Number(limit)).map((item, i) => {
            if (searchType === 'bili_user') {
                return { rank: i + 1, title: stripHtml(item.uname ?? ''), author: (item.usign ?? '').trim(), score: item.fans ?? 0, url: item.mid ? `https://space.bilibili.com/${item.mid}` : '' };
            }
            return { rank: i + 1, title: stripHtml(item.title ?? ''), author: item.author ?? '', score: item.play ?? 0, url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '' };
        });
    },
});
