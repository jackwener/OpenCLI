// Pinterest user-boards — list the boards owned by a user (BoardsResource).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { DEFAULT_PAGE_SIZE, PINTEREST_BASE, collectResults, parseUsername, requireLimit } from './utils.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 250;
const SORTS = ['last_pinned_to', 'alphabetical', 'custom'];

cli({
  site: 'pinterest',
  name: 'user-boards',
  access: 'read',
  description: 'List a user\'s boards',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'username', type: 'string', positional: true, required: true, help: 'Username or profile URL, e.g. janedoe' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of boards (max ${MAX_LIMIT})` },
    { name: 'sort', type: 'string', default: 'last_pinned_to', choices: SORTS, help: 'Board sort order' },
  ],
  columns: ['boardId', 'name', 'pinCount', 'sectionCount', 'privacy', 'url'],
  func: async (page, kwargs) => {
    const username = parseUsername(kwargs.username);
    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    const sort = String(kwargs.sort ?? 'last_pinned_to');
    if (!SORTS.includes(sort)) {
      throw new ArgumentError(`Unknown sort "${sort}". Valid: ${SORTS.join(', ')}`);
    }

    const sourceUrl = `/${username}/`;
    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const rows = await collectResults(page, {
      resource: 'BoardsResource',
      baseOptions: { username, sort, privacy_filter: 'all', field_set_key: 'profile_grid_item' },
      sourceUrl,
      limit,
      keyField: 'boardId',
      pageSize: DEFAULT_PAGE_SIZE,
      mapItem: (board) => {
        if (!board || !board.id) return null;
        return {
          boardId: String(board.id),
          name: board.name || '',
          pinCount: typeof board.pin_count === 'number' ? board.pin_count : 0,
          sectionCount: typeof board.section_count === 'number' ? board.section_count : 0,
          privacy: board.privacy || 'public',
          url: board.url ? `${PINTEREST_BASE}${board.url}` : '',
        };
      },
    });

    if (rows.length === 0) {
      throw new EmptyResultError('pinterest user-boards', `no boards found for user "${username}"`);
    }
    return rows;
  },
});
