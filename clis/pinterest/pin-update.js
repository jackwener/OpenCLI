// Pinterest pin-update — edit a pin's text or move it to another board (PinResource/update).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, resolveBoardTarget, parsePinId, pinterestResourceUpdate, resolveBoardId, resolveSection } from './utils.js';

cli({
  site: 'pinterest',
  name: 'pin-update',
  access: 'write',
  description: 'Update a pin\'s title, description, link, or board',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'pin', type: 'string', positional: true, required: true, help: 'Pin id or pin URL, e.g. 1234567890123456' },
    { name: 'title', type: 'string', default: '', help: 'New pin title' },
    // No default: an omitted flag stays undefined, so `--description ""` can clear the field.
    { name: 'description', type: 'string', help: 'New pin description (pass "" to clear)' },
    // Pinterest refuses link edits on scraped pins ("你沒有變更此連結的權限"), so this only
    // works on pins whose link you own.
    { name: 'link', type: 'string', help: 'New destination link (pass "" to clear)' },
    { name: 'board', type: 'string', default: '', help: 'Move the pin to this board: <username>/<slug>, board URL, or board id' },
    { name: 'section', type: 'string', default: '', help: 'Move the pin to this board section id or slug (requires --board)' },
  ],
  columns: ['pinId', 'title', 'board', 'url'],
  func: async (page, kwargs) => {
    const id = parsePinId(kwargs.pin);
    const title = String(kwargs.title ?? '').trim();
    const description = kwargs.description === undefined ? undefined : String(kwargs.description).trim();
    const link = kwargs.link === undefined ? undefined : String(kwargs.link).trim();
    const boardRef = String(kwargs.board ?? '').trim();
    const section = String(kwargs.section ?? '').trim();

    if (!title && description === undefined && link === undefined && !boardRef) {
      throw new ArgumentError(
        'nothing to update',
        'Pass at least one of --title, --description, --link, or --board',
      );
    }
    if (section && !boardRef) {
      throw new ArgumentError('--section requires --board', 'Sections belong to a board, so pass --board too');
    }

    const options = { id };
    let sourceUrl = `/pin/${id}/`;

    if (boardRef) {
      const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, boardRef);
      await page.goto(`${PINTEREST_BASE}${path}`);
      const { boardId } = await resolveBoardId(page, username, slug, path, preloadedBoard);
      options.board_id = boardId;
      // PinResource/update is the only endpoint that honours a section, and only under this key.
      if (section) options.board_section_id = (await resolveSection(page, boardId, section, path)).sectionId;
      sourceUrl = path;
    } else {
      await page.goto(`${PINTEREST_BASE}${sourceUrl}`);
    }

    if (title) options.title = title;
    if (description !== undefined) options.description = description;
    if (link !== undefined) options.link = link;

    const updated = await pinterestResourceUpdate(page, 'PinResource', options, sourceUrl);
    if (!updated || !updated.id) {
      throw new CommandExecutionError('Pin update did not return the updated pin');
    }

    return [{
      pinId: String(updated.id),
      title: (updated.title || updated.grid_title || title || '').trim(),
      board: (updated.board && updated.board.name) || boardRef,
      url: `${PINTEREST_BASE}/pin/${updated.id}/`,
    }];
  },
});
