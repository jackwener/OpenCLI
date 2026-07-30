// Pinterest pin-delete — delete one of your own pins (PinResource/delete).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, parsePinId, pinterestResourceDelete, pinterestResourceFetch } from './utils.js';

cli({
  site: 'pinterest',
  name: 'pin-delete',
  access: 'write',
  description: 'Delete one of your own pins',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'pin', type: 'string', positional: true, required: true, help: 'Pin id or pin URL, e.g. 1234567890123456' },
    { name: 'confirm', type: 'bool', default: false, help: 'Actually delete — without it the pin is only previewed' },
  ],
  columns: ['pinId', 'title', 'board', 'deleted'],
  func: async (page, kwargs) => {
    const id = parsePinId(kwargs.pin);
    const sourceUrl = `/pin/${id}/`;

    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const { data: pin } = await pinterestResourceFetch(
      page,
      'PinResource',
      { id, field_set_key: 'detailed' },
      sourceUrl,
    );
    if (!pin || !pin.id) {
      throw new CommandExecutionError(`Could not resolve pin "${id}" (does it exist and do you own it?)`);
    }

    const row = {
      pinId: String(pin.id),
      title: (pin.title || pin.grid_title || '').trim(),
      board: (pin.board && pin.board.name) || '',
      deleted: false,
    };

    if (kwargs.confirm !== true) {
      throw new ArgumentError(
        `Refusing to delete pin ${row.pinId}${row.title ? ` "${row.title}"` : ''}${row.board ? ` from board "${row.board}"` : ''} without --confirm`,
        'Re-run with --confirm once you are sure; deleting a pin cannot be undone',
      );
    }

    await pinterestResourceDelete(page, 'PinResource', { id: row.pinId }, sourceUrl);
    return [{ ...row, deleted: true }];
  },
});
