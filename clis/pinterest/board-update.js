// Pinterest board-update — rename, re-configure, or archive one of your boards
// (BoardResource/update; archiving is ApiResource → /v3/boards/<id>/archive/).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, resolveBoardTarget, pinterestResourceFetch, pinterestResourceUpdate, resolveBoardId } from './utils.js';

const PRIVACY = ['public', 'secret'];

cli({
  site: 'pinterest',
  name: 'board-update',
  access: 'write',
  description: 'Update the name, description, or privacy of your board, or archive it',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'board', type: 'string', positional: true, required: true, help: '<username>/<slug>, a board URL, or a numeric board id, e.g. janedoe/my-board' },
    { name: 'name', type: 'string', default: '', help: 'New board name' },
    { name: 'description', type: 'string', help: 'New board description (pass "" to clear)' },
    { name: 'privacy', type: 'string', choices: PRIVACY, help: 'New privacy: public or secret' },
    { name: 'archive', type: 'bool', default: false, help: 'Archive the board (hides it from your profile; pins are kept)' },
    { name: 'unarchive', type: 'bool', default: false, help: 'Restore an archived board' },
  ],
  columns: ['boardId', 'name', 'privacy', 'archived', 'url'],
  func: async (page, kwargs) => {
    const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, kwargs.board);
    const name = String(kwargs.name ?? '').trim();
    const description = kwargs.description === undefined ? undefined : String(kwargs.description).trim();
    const privacy = String(kwargs.privacy ?? '').trim();

    if (privacy && !PRIVACY.includes(privacy)) {
      throw new ArgumentError(`Unknown privacy "${privacy}". Valid: ${PRIVACY.join(', ')}`);
    }
    const archive = kwargs.archive === true;
    const unarchive = kwargs.unarchive === true;
    if (archive && unarchive) {
      throw new ArgumentError('--archive and --unarchive cannot be combined');
    }
    const hasFields = Boolean(name) || description !== undefined || Boolean(privacy);
    if (!hasFields && !archive && !unarchive) {
      throw new ArgumentError(
        'nothing to update',
        'Pass at least one of --name, --description, --privacy, --archive, or --unarchive',
      );
    }

    await page.goto(`${PINTEREST_BASE}${path}`);
    const { boardId, board } = await resolveBoardId(page, username, slug, path, preloadedBoard);

    let updated = null;
    if (hasFields) {
      const options = { board_id: boardId };
      if (name) options.name = name;
      if (description !== undefined) options.description = description;
      if (privacy) options.privacy = privacy;
      updated = await pinterestResourceUpdate(page, 'BoardResource', options, path);
    }

    // Archiving has no BoardResource field: the site posts to (or deletes) this v3 endpoint.
    let archived = Boolean(board && board.archived_by_me_at);
    if (archive || unarchive) {
      await pinterestResourceFetch(
        page,
        'ApiResource',
        { url: `/v3/boards/${boardId}/archive/`, data: {} },
        path,
        archive ? 'create' : 'delete',
      );
      archived = archive;
    }

    const current = updated || board || {};
    return [{
      boardId,
      name: current.name || name,
      privacy: current.privacy || privacy,
      archived,
      url: current.url ? `${PINTEREST_BASE}${current.url}` : `${PINTEREST_BASE}${path}`,
    }];
  },
});
