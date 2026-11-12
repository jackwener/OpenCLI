// Pinterest board-pins — pins inside a board or one of its sections
// (BoardResource → BoardFeedResource, or BoardSectionPinsResource with --section).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  MAX_PIN_LIMIT,
  PINTEREST_BASE,
  SECTION_PAGE_SIZE,
  PIN_ROW_COLUMNS,
  collectPins,
  pinterestResourceFetch,
  requireBookmark,
  requireLimit,
  resolveBoardTarget,
  resolveSection,
} from './utils.js';

const DEFAULT_LIMIT = 25;

cli({
  site: 'pinterest',
  name: 'board-pins',
  access: 'read',
  description: 'List pins inside a Pinterest board or board section',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'board', type: 'string', positional: true, required: true, help: '<username>/<slug>, a board URL, or a numeric board id, e.g. janedoe/my-board' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of pins (max ${MAX_PIN_LIMIT})` },
    { name: 'bookmark', type: 'string', default: '', help: 'Resume from the nextBookmark of a previous call' },
    { name: 'section', type: 'string', default: '', help: 'Only list pins in this board section (id or slug)' },
    { name: 'include-sections', type: 'bool', default: false, help: 'Also list pins filed in sections (default: board root only)' },
  ],
  columns: [...PIN_ROW_COLUMNS, 'nextBookmark'],
  func: async (page, kwargs) => {
    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_PIN_LIMIT });
    const bookmark = requireBookmark(kwargs.bookmark);
    const section = String(kwargs.section ?? '').trim();
    const includeSections = kwargs['include-sections'] === true;
    if (section && includeSections) {
      throw new ArgumentError('--section and --include-sections cannot be combined', 'Use --section for one section, or --include-sections for the whole board');
    }

    const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, kwargs.board);

    await page.goto(`${PINTEREST_BASE}${path}`);

    // The feeds require the numeric board id, which BoardResource resolves.
    // A board id argument already fetched the board, so only look it up when addressed by slug.
    const board = preloadedBoard
      || (await pinterestResourceFetch(page, 'BoardResource', { username, slug, field_set_key: 'detailed' }, path)).data;
    const boardId = board && board.id;
    if (!boardId) {
      throw new CommandExecutionError(`Could not resolve board "${username}/${slug}" (does it exist and is it public?)`);
    }

    let rows;
    if (section) {
      const resolved = await resolveSection(page, boardId, section, path);
      rows = await collectPins(page, {
        resource: 'BoardSectionPinsResource',
        // grid_item (unlike react_grid_pin) carries created_at.
        baseOptions: { section_id: resolved.sectionId, field_set_key: 'grid_item' },
        sourceUrl: resolved.slug ? `${path}${resolved.slug}/` : path,
        maxPageSize: SECTION_PAGE_SIZE,
        limit,
        bookmark,
        exposeCursor: true,
      });
    } else {
      rows = await collectPins(page, {
        resource: 'BoardFeedResource',
        baseOptions: {
          board_id: String(boardId),
          field_set_key: 'grid_item',
          // true hides pins that live in a section, which is what the board page itself shows.
          filter_section_pins: !includeSections,
        },
        sourceUrl: path,
        limit,
        bookmark,
        exposeCursor: true,
      });
    }

    if (rows.length === 0) {
      const where = section ? `section "${section}" of board "${username}/${slug}"` : `board "${username}/${slug}"`;
      throw new EmptyResultError('pinterest board-pins', bookmark ? `no more pins in ${where}` : `no pins found in ${where}`);
    }
    return rows;
  },
});
