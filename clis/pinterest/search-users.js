// Pinterest search-users — search for users (BaseSearchResource scope=users).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { DEFAULT_PAGE_SIZE, PINTEREST_BASE, collectResults, requireLimit } from './utils.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

cli({
  site: 'pinterest',
  name: 'search-users',
  access: 'read',
  description: 'Search for users on Pinterest',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', type: 'string', positional: true, required: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of users (max ${MAX_LIMIT})` },
  ],
  columns: ['username', 'fullName', 'followerCount', 'pinCount', 'url'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) throw new ArgumentError('query is required');
    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });

    const sourceUrl = `/search/users/?q=${encodeURIComponent(query)}`;
    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const rows = await collectResults(page, {
      resource: 'BaseSearchResource',
      baseOptions: { query, scope: 'users' },
      sourceUrl,
      limit,
      keyField: 'username',
      pageSize: DEFAULT_PAGE_SIZE,
      mapItem: (user) => {
        if (!user || user.type !== 'user' || !user.username) return null;
        return {
          username: user.username,
          fullName: (user.full_name || '').trim(),
          followerCount: typeof user.follower_count === 'number' ? user.follower_count : 0,
          pinCount: typeof user.pin_count === 'number' ? user.pin_count : 0,
          url: `${PINTEREST_BASE}/${user.username}/`,
        };
      },
    });

    if (rows.length === 0) {
      throw new EmptyResultError('pinterest search-users', `no users found for "${query}"`);
    }
    return rows;
  },
});
