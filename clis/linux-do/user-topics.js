import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchLinuxDoJson } from './feed.js';
function toLocalTime(utcStr) {
    if (!utcStr)
        return '';
    const date = new Date(utcStr);
    return Number.isNaN(date.getTime()) ? utcStr : date.toLocaleString();
}
cli({
    site: 'linux-do',
    name: 'user-topics',
    description: 'linux.do 用户创建的话题',
    domain: 'linux.do',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', required: true, positional: true, help: 'Username' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of topics' },
    ],
    columns: ['rank', 'title', 'replies', 'created_at', 'likes', 'views', 'url'],
    func: async (page, kwargs) => {
        const username = String(kwargs.username);
        const limit = kwargs.limit;
        const data = await fetchLinuxDoJson(page, `/topics/created-by/${encodeURIComponent(username)}.json`);
        const topics = (data?.topic_list?.topics || []);
        return topics.slice(0, limit).map((t, i) => ({
            rank: i + 1,
            title: t.fancy_title || t.title || '',
            replies: t.posts_count || 0,
            created_at: toLocalTime(t.created_at),
            likes: t.like_count || 0,
            views: t.views || 0,
            url: 'https://linux.do/t/topic/' + t.id,
        }));
    },
});
