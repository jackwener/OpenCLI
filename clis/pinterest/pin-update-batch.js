// Pinterest pin-update-batch — apply one pin-update to many pins (PinResource/update per pin).
// The board and section are resolved once, so moving N pins costs N + 2 requests in one session.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { PINTEREST_BASE, parsePinIds, runPinBatch } from './utils.js';
import { applyPinUpdate, preparePinUpdate, readPinUpdateInput } from './pin-write.js';

cli({
  site: 'pinterest',
  name: 'pin-update-batch',
  access: 'write',
  description: 'Update or move multiple pins from a comma-separated pin list',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'pins', type: 'string', positional: true, required: true, help: 'Comma-separated pin ids or pin URLs, e.g. 1234567890123456,2345678901234567' },
    // None of the field flags has a default: an omitted flag stays undefined and leaves the field
    // alone, so passing "" can clear it.
    { name: 'title', type: 'string', help: 'New pin title (pass "" to clear)' },
    { name: 'description', type: 'string', help: 'New pin description (pass "" to clear)' },
    { name: 'alt-text', type: 'string', help: 'New alt text (pass "" to clear)' },
    { name: 'board', type: 'string', default: '', help: 'Move the pins to this board: <username>/<slug>, board URL, or board id (lands on the board root unless --section is given)' },
    { name: 'section', type: 'string', help: 'With --board: board section id or slug to move the pins into ("" = board root)' },
  ],
  columns: ['pinId', 'title', 'board', 'url', 'status', 'message'],
  func: async (page, kwargs) => {
    const ids = parsePinIds(kwargs.pins);
    const input = readPinUpdateInput(kwargs);

    // A bad board or section fails here, before any pin is touched.
    const prepared = await preparePinUpdate(page, input, ids[0]);

    return runPinBatch(ids, async (id) => {
      const updated = await applyPinUpdate(page, id, prepared);
      return {
        title: (updated.title || updated.grid_title || input.fields.title || '').trim(),
        board: (updated.board && updated.board.name) || input.boardRef,
        url: `${PINTEREST_BASE}/pin/${updated.id}/`,
      };
    });
  },
});
