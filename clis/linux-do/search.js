import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchLinuxDoJson } from './feed.js';
cli({
    site: 'linux-do',
    name: 'search',
    access: 'read',
    description: '搜索 linux.do',
    domain: 'linux.do',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'views', 'likes', 'replies', 'url'],
    func: async (page, kwargs) => {
        const query = encodeURIComponent(String(kwargs.query));
        const data = await fetchLinuxDoJson(page, `/search.json?q=${query}`);
        const topics = (data?.topics || []);
        return topics.slice(0, kwargs.limit).map((t, i) => ({
            rank: i + 1,
            title: t.title,
            views: t.views,
            likes: t.like_count,
            replies: (t.posts_count || 1) - 1,
            url: 'https://linux.do/t/topic/' + t.id,
        }));
    },
});
