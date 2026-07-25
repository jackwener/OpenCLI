// Pinterest board-update — rename or re-configure one of your boards (BoardResource/update).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, resolveBoardTarget, pinterestResourceUpdate, resolveBoardId } from './utils.js';

const PRIVACY = ['public', 'secret'];

cli({
  site: 'pinterest',
  name: 'board-update',
  access: 'write',
  description: 'Update the name, description, or privacy of your board',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'board', type: 'string', positional: true, required: true, help: '<username>/<slug>, a board URL, or a numeric board id, e.g. janedoe/my-board' },
    { name: 'name', type: 'string', default: '', help: 'New board name' },
    { name: 'description', type: 'string', help: 'New board description (pass "" to clear)' },
    { name: 'privacy', type: 'string', choices: PRIVACY, help: 'New privacy: public or secret' },
  ],
  columns: ['boardId', 'name', 'privacy', 'url'],
  func: async (page, kwargs) => {
    const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, kwargs.board);
    const name = String(kwargs.name ?? '').trim();
    const description = kwargs.description === undefined ? undefined : String(kwargs.description).trim();
    const privacy = String(kwargs.privacy ?? '').trim();

    if (privacy && !PRIVACY.includes(privacy)) {
      throw new ArgumentError(`Unknown privacy "${privacy}". Valid: ${PRIVACY.join(', ')}`);
    }
    if (!name && description === undefined && !privacy) {
      throw new ArgumentError(
        'nothing to update',
        'Pass at least one of --name, --description, or --privacy',
      );
    }

    await page.goto(`${PINTEREST_BASE}${path}`);
    const { boardId } = await resolveBoardId(page, username, slug, path, preloadedBoard);

    const options = { board_id: boardId };
    if (name) options.name = name;
    if (description !== undefined) options.description = description;
    if (privacy) options.privacy = privacy;

    const updated = await pinterestResourceUpdate(page, 'BoardResource', options, path);

    return [{
      boardId,
      name: (updated && updated.name) || name,
      privacy: (updated && updated.privacy) || privacy,
      url: updated && updated.url ? `${PINTEREST_BASE}${updated.url}` : `${PINTEREST_BASE}${path}`,
    }];
  },
});
