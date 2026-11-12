// Pinterest user-pins — pins created by a user (UserPinsResource).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { MAX_PIN_LIMIT, PINTEREST_BASE, PIN_ROW_COLUMNS, collectPins, parseUsername, requireBookmark, requireLimit } from './utils.js';

const DEFAULT_LIMIT = 25;

cli({
  site: 'pinterest',
  name: 'user-pins',
  access: 'read',
  description: 'List pins created by a Pinterest user',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'username', type: 'string', positional: true, required: true, help: 'Username or profile URL, e.g. janedoe' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of pins (max ${MAX_PIN_LIMIT})` },
    { name: 'bookmark', type: 'string', default: '', help: 'Resume from the nextBookmark of a previous call' },
  ],
  columns: [...PIN_ROW_COLUMNS, 'nextBookmark'],
  func: async (page, kwargs) => {
    const username = parseUsername(kwargs.username);
    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_PIN_LIMIT });
    const bookmark = requireBookmark(kwargs.bookmark);

    const sourceUrl = `/${username}/`;
    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const rows = await collectPins(page, {
      resource: 'UserPinsResource',
      baseOptions: { username, field_set_key: 'grid_item' },
      sourceUrl,
      limit,
      bookmark,
      exposeCursor: true,
    });

    if (rows.length === 0) {
      throw new EmptyResultError('pinterest user-pins', bookmark ? `no more pins for user "${username}"` : `no pins found for user "${username}"`);
    }
    return rows;
  },
});
