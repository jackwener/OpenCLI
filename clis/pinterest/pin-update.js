// Pinterest pin-update — edit a pin's text or move it to another board (PinResource/update).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { PINTEREST_BASE, parsePinId } from './utils.js';
import { applyPinUpdate, preparePinUpdate, readPinUpdateInput } from './pin-write.js';

cli({
  site: 'pinterest',
  name: 'pin-update',
  access: 'write',
  description: 'Update a pin\'s title, description, alt text, or board',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'pin', type: 'string', positional: true, required: true, help: 'Pin id or pin URL, e.g. 1234567890123456' },
    // None of the field flags has a default: an omitted flag stays undefined and leaves the field
    // alone, so passing "" can clear it.
    { name: 'title', type: 'string', help: 'New pin title (pass "" to clear)' },
    { name: 'description', type: 'string', help: 'New pin description (pass "" to clear)' },
    { name: 'alt-text', type: 'string', help: 'New alt text (pass "" to clear)' },
    { name: 'board', type: 'string', default: '', help: 'Move the pin to this board: <username>/<slug>, board URL, or board id (lands on the board root unless --section is given)' },
    { name: 'section', type: 'string', help: 'With --board: board section id or slug to move the pin into ("" = board root)' },
  ],
  columns: ['pinId', 'title', 'board', 'url'],
  func: async (page, kwargs) => {
    const id = parsePinId(kwargs.pin);
    const input = readPinUpdateInput(kwargs);

    const prepared = await preparePinUpdate(page, input, id);
    const updated = await applyPinUpdate(page, id, prepared);

    return [{
      pinId: String(updated.id),
      title: (updated.title || updated.grid_title || input.fields.title || '').trim(),
      board: (updated.board && updated.board.name) || input.boardRef,
      url: `${PINTEREST_BASE}/pin/${updated.id}/`,
    }];
  },
});
