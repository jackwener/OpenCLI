import { cli, Strategy } from '@jackwener/opencli/registry';
import { XQUIK_BASE, addParam, normalizeUser, paginatedRows, requireString, xquikFetch } from './utils.js';

cli({
    site: 'xquik',
    name: 'user-search',
    access: 'read',
    description: 'Search X/Twitter users by name or username through Xquik.',
    domain: 'xquik.com',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'User search query' },
        { name: 'cursor', required: false, help: 'Pagination cursor from a prior response' },
    ],
    columns: ['rank', 'id', 'username', 'name', 'followers', 'following', 'verified', 'description', 'profileUrl'],
    func: async (args) => {
        const url = new URL('/api/v1/x/users/search', XQUIK_BASE);
        addParam(url, 'q', requireString(args.query, 'query'));
        addParam(url, 'cursor', args.cursor);
        const body = await xquikFetch(url, 'xquik user-search');
        return paginatedRows(body, 'users', 'xquik user-search', normalizeUser);
    },
});
