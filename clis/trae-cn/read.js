import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeLimit, normalizeMaxChars, readTraeMessages } from './utils.js';

export const readCommand = cli({
  site: 'trae-cn',
  name: 'read',
  access: 'read',
  description: 'Read the current Trae CN chat conversation',
  example: 'OPENCLI_CDP_ENDPOINT=http://127.0.0.1:39240 OPENCLI_CDP_TARGET=talk opencli trae-cn read --limit 5 --max-chars 12000 -f json',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'limit', type: 'int', required: false, help: 'Max recent turns to return (default: 20)', default: 20 },
    { name: 'max-chars', type: 'int', required: false, help: 'Max chars per turn; 0 returns full text (default: 6000)', default: 6000 },
  ],
  columns: ['Role', 'Text', 'TextChars', 'Truncated', 'TurnIndex', 'MessageId'],
  func: async (page, kwargs) => {
    const limit = normalizeLimit(kwargs.limit, 20);
    const maxChars = normalizeMaxChars(kwargs['max-chars'], 6000);
    return readTraeMessages(page, limit, maxChars);
  },
});
