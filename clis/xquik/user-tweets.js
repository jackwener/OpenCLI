import { cli, Strategy } from '@jackwener/opencli/registry';
import { XQUIK_BASE, addParam, normalizeTweet, paginatedRows, requireString, xquikFetch } from './utils.js';

cli({
    site: 'xquik',
    name: 'user-tweets',
    access: 'read',
    description: 'List recent posts from one X/Twitter user through Xquik.',
    domain: 'xquik.com',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Username without @, @username, or numeric user ID' },
        { name: 'cursor', required: false, help: 'Pagination cursor from a prior response' },
        { name: 'includeReplies', type: 'boolean', default: false, help: 'Include reply posts' },
        { name: 'includeParentTweet', type: 'boolean', default: false, help: 'Include parent tweet details for replies' },
    ],
    columns: ['rank', 'id', 'author', 'text', 'createdAt', 'likes', 'replies', 'retweets', 'views', 'url', 'nextCursor'],
    func: async (args) => {
        const id = encodeURIComponent(requireString(args.id, 'id').replace(/^@+/, ''));
        const url = new URL(`/api/v1/x/users/${id}/tweets`, XQUIK_BASE);
        addParam(url, 'cursor', args.cursor);
        addParam(url, 'includeReplies', Boolean(args.includeReplies));
        addParam(url, 'includeParentTweet', Boolean(args.includeParentTweet));
        const body = await xquikFetch(url, 'xquik user-tweets');
        return paginatedRows(body, 'tweets', 'xquik user-tweets', normalizeTweet);
    },
});
