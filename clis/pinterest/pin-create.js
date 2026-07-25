// Pinterest pin-create — create a pin from a remote image URL onto a board (PinResource/create).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, movePinToSection, pinterestResourceCreate, resolveBoardId, resolveBoardTarget, resolveSection } from './utils.js';

function requireImageUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new ArgumentError('image is required (a remote image URL)');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ArgumentError(`image must be a remote image URL (got "${raw}")`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ArgumentError(`image URL must be http(s): ${value}`);
  }
  return value;
}

cli({
  site: 'pinterest',
  name: 'pin-create',
  access: 'write',
  description: 'Create a pin from a remote image URL onto a board',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'image', type: 'string', positional: true, required: true, help: 'Direct image URL Pinterest can fetch (not a page URL), e.g. https://example.com/image.jpg' },
    { name: 'board', type: 'string', required: true, help: 'Target board: <username>/<slug>, board URL, or board id (a new pin always needs a board)' },
    { name: 'section', type: 'string', default: '', help: 'Optional board section id or slug' },
    { name: 'title', type: 'string', default: '', help: 'Pin title' },
    // Pinterest ignores description for scraped pins (it derives one from the source page).
    { name: 'description', type: 'string', default: '', help: 'Pin description (Pinterest may override it for scraped images)' },
    { name: 'link', type: 'string', default: '', help: 'Destination link for the pin' },
  ],
  columns: ['pinId', 'board', 'title', 'url'],
  func: async (page, kwargs) => {
    const imageUrl = requireImageUrl(kwargs.image);
    const { username, slug, path, board: preloadedBoard } = await resolveBoardTarget(page, kwargs.board);
    const section = String(kwargs.section ?? '').trim();
    const title = String(kwargs.title ?? '').trim();
    const description = String(kwargs.description ?? '').trim();
    const link = String(kwargs.link ?? '').trim();

    await page.goto(`${PINTEREST_BASE}${path}`);

    // Resolve the numeric board id the create call needs.
    const { boardId } = await resolveBoardId(page, username, slug, path, preloadedBoard);

    // Validate --section before creating, so a bad value fails before a pin exists.
    const sectionId = section ? (await resolveSection(page, boardId, section, path)).sectionId : '';

    const options = { board_id: boardId, image_url: imageUrl, method: 'scraped' };
    if (title) options.title = title;
    if (description) options.description = description;
    if (link) options.link = link;

    const created = await pinterestResourceCreate(page, 'PinResource', options, path);
    const newId = created && created.id;
    if (!newId) {
      throw new CommandExecutionError('Pin creation did not return a pin id');
    }

    if (sectionId) {
      await movePinToSection(page, newId, boardId, sectionId, path);
    }

    return [{
      pinId: String(newId),
      board: (created.board && created.board.name) || `${username}/${slug}`,
      title: (created.title || created.grid_title || title || '').trim(),
      url: `${PINTEREST_BASE}/pin/${newId}/`,
    }];
  },
});
