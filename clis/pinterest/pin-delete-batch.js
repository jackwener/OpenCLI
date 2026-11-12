// Pinterest pin-delete-batch — delete many of your own pins (PinResource/delete per pin).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, parsePinIds, pinterestResourceDelete, runPinBatch } from './utils.js';

cli({
  site: 'pinterest',
  name: 'pin-delete-batch',
  access: 'write',
  description: 'Delete multiple of your own pins from a comma-separated pin list',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'pins', type: 'string', positional: true, required: true, help: 'Comma-separated pin ids or pin URLs, e.g. 1234567890123456,2345678901234567' },
    { name: 'confirm', type: 'bool', default: false, help: 'Actually delete — without it nothing is touched' },
  ],
  columns: ['pinId', 'deleted', 'status', 'message'],
  func: async (page, kwargs) => {
    const ids = parsePinIds(kwargs.pins);

    if (kwargs.confirm !== true) {
      throw new ArgumentError(
        `Refusing to delete ${ids.length} pin${ids.length === 1 ? '' : 's'} without --confirm`,
        'Inspect them with `opencli pinterest pin <id>`, then re-run with --confirm; deleting a pin cannot be undone',
      );
    }

    await page.goto(`${PINTEREST_BASE}/pin/${ids[0]}/`);

    const rows = await runPinBatch(ids, async (id) => {
      await pinterestResourceDelete(page, 'PinResource', { id }, `/pin/${id}/`);
      return {};
    });
    return rows.map((row) => ({ pinId: row.pinId, deleted: row.status === 'success', status: row.status, message: row.message }));
  },
});
