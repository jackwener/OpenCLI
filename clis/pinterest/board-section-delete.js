// Pinterest board-section-delete — remove a section from one of your boards (ApiResource/delete → /v3/board/sections/).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, resolveBoardTarget, pinterestResourceFetch, resolveBoardId, resolveSection } from './utils.js';

cli({
  site: 'pinterest',
  name: 'board-section-delete',
  access: 'write',
  description: 'Delete a section from one of your boards',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'board', type: 'string', positional: true, required: true, help: '<username>/<slug>, a board URL, or a numeric board id, e.g. janedoe/my-board' },
    { name: 'section', type: 'string', required: true, help: 'Section id or slug (from `board-sections`)' },
    { name: 'confirm', type: 'bool', default: false, help: 'Actually delete — without it nothing is removed' },
  ],
  columns: ['sectionId', 'board', 'deleted'],
  func: async (page, kwargs) => {
    const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, kwargs.board);
    const section = String(kwargs.section ?? '').trim();
    if (!section) throw new ArgumentError('section is required', 'List sections with `pinterest board-sections <board>`');

    await page.goto(`${PINTEREST_BASE}${path}`);
    const { boardId } = await resolveBoardId(page, username, slug, path, preloadedBoard);
    // Resolve before the gate so the preview names the section that would actually be deleted.
    const { sectionId, title } = await resolveSection(page, boardId, section, path);

    // Deleting a section returns its pins to the board rather than destroying them,
    // but it is still not undoable, so keep the same --confirm gate as the other deletes.
    if (kwargs.confirm !== true) {
      throw new ArgumentError(
        `Refusing to delete section "${title || sectionId}" without --confirm`,
        'Re-run with --confirm once you are sure',
      );
    }

    // BoardSectionResource only implements `create`; deletes go through the v3 API proxy.
    await pinterestResourceFetch(
      page,
      'ApiResource',
      { url: `/v3/board/sections/${sectionId}/`, data: {} },
      path,
      'delete',
    );

    return [{ sectionId, board: `${username}/${slug}`, deleted: true }];
  },
});
