// Pinterest user-boards — list the boards owned by a user (BoardsResource).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, collectResults, parseUsername, requireBookmark, requireLimit, toIsoDate } from './utils.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 500;
const SORTS = ['last_pinned_to', 'alphabetical', 'custom'];
// Secret boards only show up for their owner.
const PRIVACY_FILTERS = ['all', 'public', 'secret'];

cli({
  site: 'pinterest',
  name: 'user-boards',
  access: 'read',
  description: 'List a user\'s boards',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'username', type: 'string', positional: true, required: true, help: 'Username or profile URL, e.g. janedoe' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of boards (max ${MAX_LIMIT})` },
    { name: 'bookmark', type: 'string', default: '', help: 'Resume from the nextBookmark of a previous call' },
    { name: 'sort', type: 'string', default: 'last_pinned_to', choices: SORTS, help: 'Board sort order' },
    { name: 'privacy', type: 'string', default: 'all', choices: PRIVACY_FILTERS, help: 'Only boards with this privacy (secret needs you to be the owner)' },
  ],
  columns: [
    'boardId', 'name', 'description', 'pinCount', 'sectionCount', 'privacy', 'followerCount', 'collaboratorCount',
    'createdAt', 'coverImageUrl', 'url', 'nextBookmark',
  ],
  func: async (page, kwargs) => {
    const username = parseUsername(kwargs.username);
    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    const bookmark = requireBookmark(kwargs.bookmark);
    const sort = String(kwargs.sort ?? 'last_pinned_to');
    if (!SORTS.includes(sort)) {
      throw new ArgumentError(`Unknown sort "${sort}". Valid: ${SORTS.join(', ')}`);
    }
    const privacy = String(kwargs.privacy ?? 'all');
    if (!PRIVACY_FILTERS.includes(privacy)) {
      throw new ArgumentError(`Unknown privacy "${privacy}". Valid: ${PRIVACY_FILTERS.join(', ')}`);
    }

    const sourceUrl = `/${username}/`;
    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const num = (value) => (typeof value === 'number' ? value : 0);
    const rows = await collectResults(page, {
      resource: 'BoardsResource',
      baseOptions: { username, sort, privacy_filter: privacy, field_set_key: 'profile_grid_item' },
      sourceUrl,
      limit,
      bookmark,
      exposeCursor: true,
      keyField: 'boardId',
      mapItem: (board) => {
        if (!board || !board.id) return null;
        return {
          boardId: String(board.id),
          name: board.name || '',
          description: (board.description || '').trim(),
          pinCount: num(board.pin_count),
          sectionCount: num(board.section_count),
          privacy: board.privacy || 'public',
          followerCount: num(board.follower_count),
          collaboratorCount: num(board.collaborator_count),
          createdAt: toIsoDate(board.created_at),
          coverImageUrl: board.image_cover_hd_url || board.image_cover_url || '',
          url: board.url ? `${PINTEREST_BASE}${board.url}` : '',
        };
      },
    });

    if (rows.length === 0) {
      throw new EmptyResultError('pinterest user-boards', bookmark ? `no more boards for user "${username}"` : `no boards found for user "${username}"`);
    }
    return rows;
  },
});
