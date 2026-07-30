// Pinterest board-create — create a new board (BoardResource/create).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, pinterestResourceCreate } from './utils.js';

const PRIVACY = ['public', 'secret'];

cli({
  site: 'pinterest',
  name: 'board-create',
  access: 'write',
  description: 'Create a new board on your account',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'name', type: 'string', positional: true, required: true, help: 'Board name' },
    { name: 'description', type: 'string', default: '', help: 'Board description' },
    { name: 'privacy', type: 'string', default: 'public', choices: PRIVACY, help: 'public or secret' },
  ],
  columns: ['boardId', 'name', 'privacy', 'url'],
  func: async (page, kwargs) => {
    const name = String(kwargs.name ?? '').trim();
    if (!name) throw new ArgumentError('board name is required');
    const description = String(kwargs.description ?? '').trim();
    const privacy = String(kwargs.privacy ?? 'public');
    if (!PRIVACY.includes(privacy)) {
      throw new ArgumentError(`Unknown privacy "${privacy}". Valid: ${PRIVACY.join(', ')}`);
    }

    await page.goto(`${PINTEREST_BASE}/`);

    const options = { name, privacy };
    if (description) options.description = description;

    const created = await pinterestResourceCreate(page, 'BoardResource', options, '/');
    const boardId = created && created.id;
    if (!boardId) {
      throw new CommandExecutionError('Board creation did not return a board id');
    }

    return [{
      boardId: String(boardId),
      name: created.name || name,
      privacy: created.privacy || privacy,
      url: created.url ? `${PINTEREST_BASE}${created.url}` : '',
    }];
  },
});
