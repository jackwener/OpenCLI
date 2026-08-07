// Pinterest board-delete — delete one of your own boards (BoardResource/delete).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, resolveBoardTarget, pinterestResourceDelete, resolveBoardId } from './utils.js';

cli({
  site: 'pinterest',
  name: 'board-delete',
  access: 'write',
  description: 'Delete one of your own boards',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'board', type: 'string', positional: true, required: true, help: '<username>/<slug>, a board URL, or a numeric board id, e.g. janedoe/my-board' },
    { name: 'confirm', type: 'bool', default: false, help: 'Actually delete — without it the board is only previewed' },
  ],
  columns: ['boardId', 'name', 'pinCount', 'deleted'],
  func: async (page, kwargs) => {
    const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, kwargs.board);

    await page.goto(`${PINTEREST_BASE}${path}`);
    const { boardId, board } = await resolveBoardId(page, username, slug, path, preloadedBoard);

    const row = {
      boardId,
      name: board.name || `${username}/${slug}`,
      pinCount: typeof board.pin_count === 'number' ? board.pin_count : 0,
      deleted: false,
    };

    // Deleting a board also destroys the pins saved in it, so require an explicit opt-in.
    if (kwargs.confirm !== true) {
      throw new ArgumentError(
        `Refusing to delete board "${row.name}" (${row.pinCount} pins) without --confirm`,
        'Re-run with --confirm once you are sure; deleting a board also deletes its pins',
      );
    }

    await pinterestResourceDelete(page, 'BoardResource', { board_id: boardId }, path);
    return [{ ...row, deleted: true }];
  },
});
