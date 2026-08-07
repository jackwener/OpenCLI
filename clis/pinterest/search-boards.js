// Pinterest search-boards — search for boards (BaseSearchResource scope=boards).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { DEFAULT_PAGE_SIZE, PINTEREST_BASE, collectResults, requireLimit } from './utils.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

cli({
  site: 'pinterest',
  name: 'search-boards',
  access: 'read',
  description: 'Search for boards on Pinterest',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', type: 'string', positional: true, required: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of boards (max ${MAX_LIMIT})` },
  ],
  columns: ['boardId', 'name', 'pinCount', 'owner', 'description', 'url'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) throw new ArgumentError('query is required');
    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });

    const sourceUrl = `/search/boards/?q=${encodeURIComponent(query)}`;
    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const rows = await collectResults(page, {
      resource: 'BaseSearchResource',
      baseOptions: { query, scope: 'boards' },
      sourceUrl,
      limit,
      keyField: 'boardId',
      pageSize: DEFAULT_PAGE_SIZE,
      mapItem: (board) => {
        if (!board || board.type !== 'board' || !board.id) return null;
        return {
          boardId: String(board.id),
          name: board.name || '',
          pinCount: typeof board.pin_count === 'number' ? board.pin_count : 0,
          owner: (board.owner && board.owner.username) || '',
          description: (board.description || '').trim(),
          url: board.url ? `${PINTEREST_BASE}${board.url}` : '',
        };
      },
    });

    if (rows.length === 0) {
      throw new EmptyResultError('pinterest search-boards', `no boards found for "${query}"`);
    }
    return rows;
  },
});
