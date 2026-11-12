// Pinterest save — repin an existing pin to your profile or a board (RepinResource/create; no board_id → profile).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parsePinId } from './utils.js';
import { prepareSaveTarget, savePin } from './pin-write.js';

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
    const target = await prepareSaveTarget(page, kwargs);
    return [await savePin(page, sourcePinId, target)];
  },
});
