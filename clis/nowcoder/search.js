import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import {
    fetchNowcoderData,
    projectNowcoderFeed,
    requirePositiveInt,
} from './posts.js';

cli({
    site: 'nowcoder',
    name: 'search',
    access: 'read',
    description: 'Search content and moment posts',
    domain: 'www.nowcoder.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'type', type: 'str', default: 'post', help: 'Post search scope (post/all)' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of posts (1-50)' },
    ],
    columns: ['rank', 'post_type', 'id', 'uuid', 'entity_id', 'url', 'title', 'author', 'author_id', 'author_url', 'school', 'content', 'likes', 'comments', 'views', 'time'],
    func: async (page, args) => {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        if (!query) throw new ArgumentError('nowcoder search requires a non-empty query');
        const type = args.type ?? 'post';
        if (type !== 'all' && type !== 'post') {
            throw new ArgumentError('nowcoder search --type must be all or post');
        }
        const limit = requirePositiveInt(args.limit ?? 10, 'limit', 50);
        const data = await fetchNowcoderData(
            page,
            'https://gw-c.nowcoder.com/api/sparta/pc/search',
            { method: 'POST', body: { query, type, page: 1, pageSize: limit }, timeoutMs: 15_000 },
            'Nowcoder search request',
        );
        return projectNowcoderFeed(data.records, limit, 'search', type === 'all');
    },
});
