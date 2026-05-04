/**
 * Pixiv search — search illustrations by keyword/tag.
 *
 * Uses the internal Ajax search API with browser cookies for authentication.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { pixivFetch } from './utils.js';
cli({
    site: 'pixiv',
    name: 'search',
    access: 'read',
    description: 'Search Pixiv illustrations by keyword',
    domain: 'www.pixiv.net',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword or tag' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
        { name: 'order', type: 'str', default: 'date_d', help: 'Sort order', choices: ['date_d', 'date', 'popular_d', 'popular_male_d', 'popular_female_d'] },
        { name: 'mode', type: 'str', default: 'all', help: 'Search mode', choices: ['all', 'safe', 'r18'] },
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
    ],
    columns: ['rank', 'title', 'author', 'user_id', 'illust_id', 'pages', 'bookmarks', 'tags', 'url'],
    func: async (page, kwargs) => {
        const { query, limit = 20, order = 'date_d', mode = 'all', page: pageNum = 1 } = kwargs;
        const encoded = encodeURIComponent(query);
        // Pixiv search API requires the keyword in BOTH the URL path and the `word` query param.
        const body = await pixivFetch(page, `/ajax/search/illustrations/${encoded}`, { params: { word: query, order, mode, p: pageNum, s_mode: 's_tag_full', type: 'illust_and_ugoira' } });
        const items = body?.illust?.data || [];
        return items
            .filter((item) => item.id)
            .slice(0, Number(limit))
            .map((item, i) => ({
            rank: i + 1,
            title: item.title || '',
            author: item.userName || '',
            user_id: item.userId || '',
            illust_id: item.id,
            pages: item.pageCount || 1,
            bookmarks: item.bookmarkCount || 0,
            tags: (item.tags || []).slice(0, 5).join(', '),
            url: 'https://www.pixiv.net/artworks/' + item.id,
        }));
    },
});
