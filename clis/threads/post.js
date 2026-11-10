import { cli, Strategy } from '@jackwener/opencli/registry';
import { collectPosts, parseLimit, parsePostTarget, postRows, requireRows } from './utils.js';

export const command = cli({
    site: 'threads',
    name: 'post',
    access: 'read',
    description: 'Read a Threads post and its replies',
    domain: 'www.threads.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'target', required: true, positional: true, help: 'Post URL or shortcode' },
        { name: 'limit', type: 'int', default: 30, help: 'Maximum number of replies (max 100)' },
    ],
    columns: ['type', 'author', 'text', 'likes', 'replies', 'published_at', 'url'],
    func: async (page, kwargs) => {
        const target = parsePostTarget(kwargs.target);
        const limit = parseLimit(kwargs.limit, 30, { min: 0 });
        const result = await collectPosts(page, target.url, {
            limit,
            scrolls: Math.ceil(limit / 10) + 2,
            kind: 'reply',
            code: target.code,
        });
        return requireRows(
            postRows(result.posts, target.code, limit),
            result,
            'post',
            `Post ${target.code} was not found on the rendered page.`,
            limit + 1,
        );
    },
});
