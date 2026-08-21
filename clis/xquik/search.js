import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    XQUIK_API_BASE,
    normalizeSearchRow,
    requireBoundedInt,
    requireString,
    xquikFetch,
} from './utils.js';

const SORT_CHOICES = Object.freeze(['Latest', 'Top']);

cli({
    site: 'xquik',
    name: 'search',
    access: 'read',
    description: 'Search X posts through the Xquik API without a browser session',
    domain: 'xquik.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'X search query, Tweet ID, or X status URL' },
        { name: 'sort', choices: SORT_CHOICES, default: 'Latest', help: 'Sort results by Latest or Top' },
        { name: 'limit', type: 'int', default: 20, help: 'Maximum posts to return (1-100)' },
        { name: 'timeout', type: 'int', default: 30, help: 'Request timeout in seconds (1-120)' },
    ],
    columns: [
        'rank', 'id', 'author', 'name', 'bio', 'text', 'created_at', 'likes',
        'retweets', 'replies', 'quotes', 'bookmarks', 'views', 'url', 'media_urls',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'search query');
        const limit = requireBoundedInt(args.limit, 20, 100, 'search --limit');
        const timeout = requireBoundedInt(args.timeout, 30, 120, 'search --timeout');
        const sort = args.sort ?? 'Latest';
        if (!SORT_CHOICES.includes(sort)) {
            throw new ArgumentError('xquik search --sort must be Latest or Top');
        }
        const params = new URLSearchParams({
            q: query,
            queryType: sort,
            limit: String(limit),
        });
        const body = await xquikFetch(
            `${XQUIK_API_BASE}/x/tweets/search?${params}`,
            'xquik search',
            timeout,
        );
        if (!Array.isArray(body?.tweets)) {
            throw new CommandExecutionError('xquik search returned an unexpected payload shape');
        }
        if (!body.tweets.length) {
            throw new EmptyResultError('xquik search', `No X posts matched "${query}".`);
        }
        return body.tweets.slice(0, limit).map((tweet, index) => normalizeSearchRow(tweet, index + 1));
    },
});

export const __test__ = { SORT_CHOICES };
