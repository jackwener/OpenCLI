// Pinterest save-batch — repin many pins to your profile or one board (RepinResource/create per pin).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parsePinIds, runPinBatch } from './utils.js';
import { prepareSaveTarget, savePin } from './pin-write.js';

cli({
  site: 'pinterest',
  name: 'save-batch',
  access: 'write',
  description: 'Save multiple pins to your profile or a board from a comma-separated pin list',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'pins', type: 'string', positional: true, required: true, help: 'Comma-separated pin ids or pin URLs to repin, e.g. 1234567890123456,2345678901234567' },
    { name: 'board', type: 'string', help: 'Target board: <username>/<slug>, board URL, or board id (omit to save to your profile)' },
    { name: 'section', type: 'string', default: '', help: 'Optional board section id or slug (requires --board)' },
  ],
  columns: ['sourcePinId', 'pinId', 'board', 'url', 'status', 'message'],
  func: async (page, kwargs) => {
    const ids = parsePinIds(kwargs.pins);
    // A bad board or section fails here, before anything is saved.
    const target = await prepareSaveTarget(page, kwargs);

    const rows = await runPinBatch(ids, (sourcePinId) => savePin(page, sourcePinId, target));
    // runPinBatch keys rows by the input id; here that is the source pin, and pinId is the new one.
    return rows.map((row) => (row.status === 'success' ? row : { sourcePinId: row.pinId, pinId: '', board: '', url: '', status: row.status, message: row.message }));
  },
});
