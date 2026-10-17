import { cli, Strategy } from '@jackwener/opencli/registry';
import { collectPosts, parseLimit, parseUsername, requireRows, THREADS_ORIGIN, userRows } from './utils.js';

export const command = cli({
    site: 'threads',
    name: 'user',
    access: 'read',
    description: "List a Threads user's recent public posts",
    domain: 'www.threads.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'username', required: true, positional: true, help: 'Username, with or without @, or a profile URL' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts (max 100)' },
        { name: 'replies', type: 'boolean', default: false, help: "Include the user's replies" },
    ],
    columns: ['rank', 'author', 'text', 'likes', 'replies', 'reposts', 'is_reply', 'published_at', 'url'],
    func: async (page, kwargs) => {
        const username = parseUsername(kwargs.username);
        const limit = parseLimit(kwargs.limit, 20);
        const withReplies = kwargs.replies === true || kwargs.replies === 'true';
        const url = `${THREADS_ORIGIN}/@${username}${withReplies ? '/replies' : ''}`;
        const result = await collectPosts(page, url, {
            limit,
            scrolls: Math.ceil(limit / 8) + 2,
        });
        return requireRows(
            userRows(result.posts, username, limit, withReplies),
            result,
            'user',
            `No posts by @${username} were rendered.`,
        );
    },
});
