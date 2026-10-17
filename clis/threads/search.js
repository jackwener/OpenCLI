import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { collectPosts, parseLimit, requireRows, searchRows, searchUrl } from './utils.js';

export const command = cli({
    site: 'threads',
    name: 'search',
    access: 'read',
    description: 'Search Threads posts',
    domain: 'www.threads.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 100)' },
        { name: 'sort', type: 'string', default: 'top', choices: ['top', 'recent'], help: 'Top or most recent posts' },
    ],
    columns: ['rank', 'author', 'text', 'likes', 'replies', 'reposts', 'published_at', 'url'],
    func: async (page, kwargs) => {
        const query = String(kwargs.query ?? '').trim();
        if (!query) throw new ArgumentError('query must not be empty');
        const limit = parseLimit(kwargs.limit, 20);
        const result = await collectPosts(page, searchUrl(query, kwargs.sort), {
            limit,
            scrolls: Math.ceil(limit / 8) + 2,
        });
        return requireRows(searchRows(result.posts, limit), result, 'search');
    },
});
