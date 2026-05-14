import { cli, Strategy } from '@jackwener/opencli/registry';
import { XQUIK_BASE, addParam, normalizeTweet, paginatedRows, requireBoundedInt, requireString, xquikFetch } from './utils.js';

cli({
    site: 'xquik',
    name: 'search',
    access: 'read',
    description: 'Search public X/Twitter posts through Xquik.',
    domain: 'xquik.com',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'X search query, including operators such as from:user or has:media' },
        { name: 'limit', type: 'int', default: 20, help: 'Max posts to return (1-200)' },
        { name: 'queryType', default: 'Latest', choices: ['Latest', 'Top'], help: 'Search order: Latest or Top' },
        { name: 'cursor', required: false, help: 'Pagination cursor from a prior response' },
        { name: 'sinceTime', required: false, help: 'Only return posts after this ISO 8601 timestamp' },
        { name: 'untilTime', required: false, help: 'Only return posts before this ISO 8601 timestamp' },
    ],
    columns: ['rank', 'id', 'author', 'text', 'createdAt', 'likes', 'replies', 'retweets', 'views', 'url', 'nextCursor'],
    func: async (args) => {
        const url = new URL('/api/v1/x/tweets/search', XQUIK_BASE);
        addParam(url, 'q', requireString(args.query, 'query'));
        addParam(url, 'limit', requireBoundedInt(args.limit, 20, 200));
        addParam(url, 'queryType', args.queryType ?? 'Latest');
        addParam(url, 'cursor', args.cursor);
        addParam(url, 'sinceTime', args.sinceTime);
        addParam(url, 'untilTime', args.untilTime);
        const body = await xquikFetch(url, 'xquik search');
        return paginatedRows(body, 'tweets', 'xquik search', normalizeTweet);
    },
});
