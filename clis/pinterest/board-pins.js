// Pinterest board-pins — pins inside a board (BoardResource → BoardFeedResource).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { DEFAULT_PAGE_SIZE, PINTEREST_BASE, collectPins, resolveBoardTarget, pinterestResourceFetch, requireLimit } from './utils.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

cli({
  site: 'pinterest',
  name: 'board-pins',
  access: 'read',
  description: 'List pins inside a Pinterest board',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'board', type: 'string', positional: true, required: true, help: '<username>/<slug>, a board URL, or a numeric board id, e.g. janedoe/my-board' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of pins (max ${MAX_LIMIT})` },
  ],
  columns: ['pinId', 'title', 'description', 'pinner', 'board', 'imageUrl', 'url'],
  func: async (page, kwargs) => {
    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, kwargs.board);

    await page.goto(`${PINTEREST_BASE}${path}`);

    // BoardFeedResource requires the numeric board id, which BoardResource resolves.
    // A board id argument already fetched the board, so only look it up when addressed by slug.
    const board = preloadedBoard
      || (await pinterestResourceFetch(page, 'BoardResource', { username, slug, field_set_key: 'detailed' }, path)).data;
    const boardId = board && board.id;
    if (!boardId) {
      throw new CommandExecutionError(`Could not resolve board "${username}/${slug}" (does it exist and is it public?)`);
    }

    const rows = await collectPins(page, {
      resource: 'BoardFeedResource',
      baseOptions: {
        board_id: String(boardId),
        board_url: path,
        currentFilter: -1,
        field_set_key: 'react_grid_pin',
        filter_section_pins: true,
        sort: 'default',
        layout: 'default',
      },
      sourceUrl: path,
      limit,
      pageSize: DEFAULT_PAGE_SIZE,
    });

    if (rows.length === 0) {
      throw new EmptyResultError('pinterest board-pins', `no pins found in board "${username}/${slug}"`);
    }
    return rows;
  },
});
