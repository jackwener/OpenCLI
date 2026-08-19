// Pinterest board-section-create — add a section to one of your boards (BoardSectionResource/create).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, resolveBoardTarget, pinterestResourceCreate, resolveBoardId } from './utils.js';

cli({
  site: 'pinterest',
  name: 'board-section-create',
  access: 'write',
  description: 'Create a section inside one of your boards',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'board', type: 'string', positional: true, required: true, help: '<username>/<slug>, a board URL, or a numeric board id, e.g. janedoe/my-board' },
    { name: 'title', type: 'string', required: true, help: 'Section title' },
  ],
  columns: ['sectionId', 'title', 'slug', 'board', 'url'],
  func: async (page, kwargs) => {
    const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, kwargs.board);
    const title = String(kwargs.title ?? '').trim();
    if (!title) throw new ArgumentError('section title is required');

    await page.goto(`${PINTEREST_BASE}${path}`);
    const { boardId } = await resolveBoardId(page, username, slug, path, preloadedBoard);

    // The section title goes in `name` here (a `title` key is rejected as a missing parameter).
    const created = await pinterestResourceCreate(
      page,
      'BoardSectionResource',
      { board_id: boardId, name: title },
      path,
    );
    const sectionId = created && created.id;
    if (!sectionId) {
      throw new CommandExecutionError('Section creation did not return a section id');
    }

    return [{
      sectionId: String(sectionId),
      title: created.title || created.name || title,
      slug: created.slug || '',
      board: `${username}/${slug}`,
      url: created.slug ? `${PINTEREST_BASE}${path}${created.slug}/` : '',
    }];
  },
});
