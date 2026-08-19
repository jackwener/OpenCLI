// Pinterest save — repin an existing pin to your profile or a board (RepinResource/create; no board_id → profile).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, movePinToSection, parsePinId, pinterestResourceCreate, resolveBoardId, resolveBoardTarget, resolveSection } from './utils.js';

cli({
  site: 'pinterest',
  name: 'save',
  access: 'write',
  description: 'Save a pin to your profile or a board',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'pin', type: 'string', positional: true, required: true, help: 'Pin id or pin URL to repin, e.g. 1234567890123456' },
    { name: 'board', type: 'string', help: 'Target board: <username>/<slug>, board URL, or board id (omit to save to your profile)' },
    { name: 'section', type: 'string', default: '', help: 'Optional board section id or slug (requires --board)' },
  ],
  columns: ['pinId', 'sourcePinId', 'board', 'url'],
  func: async (page, kwargs) => {
    const sourcePinId = parsePinId(kwargs.pin);
    const boardRef = String(kwargs.board ?? '').trim();
    const section = String(kwargs.section ?? '').trim();
    if (section && !boardRef) {
      throw new ArgumentError('--section requires --board', 'Sections belong to a board, so pass --board too');
    }

    const options = { pin_id: sourcePinId };
    let sourceUrl = '/';
    let sectionId = '';

    if (boardRef) {
      const { username, slug, path, board } = await resolveBoardTarget(page, boardRef);
      await page.goto(`${PINTEREST_BASE}${path}`);

      const { boardId } = await resolveBoardId(page, username, slug, path, board);
      options.board_id = boardId;
      sourceUrl = path;
      // Validate --section before repinning, so a bad value fails before anything is created.
      if (section) sectionId = (await resolveSection(page, options.board_id, section, path)).sectionId;
    } else {
      // No board given: Pinterest routes a boardless repin to the profile's Quick Saves board.
      await page.goto(`${PINTEREST_BASE}/`);
    }

    const created = await pinterestResourceCreate(page, 'RepinResource', options, sourceUrl);
    const newId = created && created.id;
    if (!newId) {
      throw new CommandExecutionError('Repin did not return a pin id');
    }

    if (sectionId) {
      await movePinToSection(page, newId, options.board_id, sectionId, sourceUrl);
    }

    return [{
      pinId: String(newId),
      sourcePinId,
      board: (created.board && created.board.name) || (boardRef || 'profile'),
      url: `${PINTEREST_BASE}/pin/${newId}/`,
    }];
  },
});
