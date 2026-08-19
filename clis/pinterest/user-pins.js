// Pinterest user-pins — pins created by a user (UserPinsResource).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { DEFAULT_PAGE_SIZE, PINTEREST_BASE, collectPins, parseUsername, requireLimit } from './utils.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

cli({
  site: 'pinterest',
  name: 'user-pins',
  access: 'read',
  description: 'List pins created by a Pinterest user',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'username', type: 'string', positional: true, required: true, help: 'Username or profile URL, e.g. janedoe' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of pins (max ${MAX_LIMIT})` },
  ],
  columns: ['pinId', 'title', 'description', 'pinner', 'board', 'imageUrl', 'url'],
  func: async (page, kwargs) => {
    const username = parseUsername(kwargs.username);
    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });

    const sourceUrl = `/${username}/`;
    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const rows = await collectPins(page, {
      resource: 'UserPinsResource',
      baseOptions: { username, field_set_key: 'grid_item' },
      sourceUrl,
      limit,
      pageSize: DEFAULT_PAGE_SIZE,
    });

    if (rows.length === 0) {
      throw new EmptyResultError('pinterest user-pins', `no pins found for user "${username}"`);
    }
    return rows;
  },
});
