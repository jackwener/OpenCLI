import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchLinuxDoJson } from './feed.js';
import { stripHtml as strip, toLocalTime } from './format.js';
cli({
    site: 'linux-do',
    name: 'user-posts',
    access: 'read',
    description: 'linux.do 用户的帖子',
    domain: 'linux.do',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', required: true, positional: true, help: 'Username' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['index', 'topic_user', 'topic', 'reply', 'time', 'url'],
    func: async (page, kwargs) => {
        const username = String(kwargs.username);
        const limit = kwargs.limit;
        const data = await fetchLinuxDoJson(page, `/user_actions.json?username=${encodeURIComponent(username)}&filter=5&offset=0&limit=${limit}`);
        const actions = (data?.user_actions || []);
        return actions.slice(0, limit).map((a, i) => ({
            index: i + 1,
            topic_user: a.acting_username || a.username || '',
            topic: a.title || '',
            reply: strip(a.excerpt).slice(0, 200),
            time: toLocalTime(a.created_at),
            url: 'https://linux.do/t/topic/' + a.topic_id + '/' + a.post_number,
        }));
    },
});
