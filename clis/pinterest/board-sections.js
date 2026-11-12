// Pinterest board-sections — sections inside a board (BoardResource → BoardSectionsResource).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, resolveBoardTarget, pinterestResourceFetch } from './utils.js';


cli({
  site: 'pinterest',
  name: 'board-sections',
  access: 'read',
  description: 'List the sections inside a Pinterest board',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'board', type: 'string', positional: true, required: true, help: '<username>/<slug>, a board URL, or a numeric board id, e.g. janedoe/my-board' },
  ],
  columns: ['sectionId', 'title', 'slug', 'pinCount', 'url'],
  func: async (page, kwargs) => {
    const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, kwargs.board);

    await page.goto(`${PINTEREST_BASE}${path}`);

    // A board id argument already fetched the board, so only look it up when addressed by slug.
    const board = preloadedBoard
      || (await pinterestResourceFetch(page, 'BoardResource', { username, slug, field_set_key: 'detailed' }, path)).data;
    const boardId = board && board.id;
    if (!boardId) {
      throw new CommandExecutionError(`Could not resolve board "${username}/${slug}" (does it exist and is it public?)`);
    }

    const { results } = await pinterestResourceFetch(
      page,
      'BoardSectionsResource',
      { board_id: String(boardId) },
      path,
    );

    const rows = results
      .filter((section) => section && section.id)
      .map((section) => ({
        sectionId: String(section.id),
        title: (section.title || '').trim(),
        slug: section.slug || '',
        pinCount: typeof section.pin_count === 'number' ? section.pin_count : 0,
        url: section.slug ? `${PINTEREST_BASE}${path}${section.slug}/` : '',
      }));

    if (rows.length === 0) {
      throw new EmptyResultError('pinterest board-sections', `board "${username}/${slug}" has no sections`);
    }
    return rows;
  },
});
