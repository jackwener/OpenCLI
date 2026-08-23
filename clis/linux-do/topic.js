import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchLinuxDoJson } from './feed.js';
import { stripHtml as strip, toLocalTime } from './format.js';
cli({
    site: 'linux-do',
    name: 'topic',
    access: 'read',
    description: 'linux.do 帖子首页摘要和回复（首屏）',
    domain: 'linux.do',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'id', type: 'int', required: true, positional: true, help: 'Topic ID' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['author', 'content', 'likes', 'created_at'],
    func: async (page, kwargs) => {
        const data = await fetchLinuxDoJson(page, `/t/${kwargs.id}.json`);
        const posts = (data?.post_stream?.posts || []);
        return posts.slice(0, kwargs.limit).map((p) => ({
            author: p.username,
            content: strip(p.cooked).slice(0, 200),
            likes: p.like_count,
            created_at: toLocalTime(p.created_at),
        }));
    },
});
