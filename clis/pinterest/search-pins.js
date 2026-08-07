// Pinterest search-pins — search pins by keyword (BaseSearchResource scope=pins).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { DEFAULT_PAGE_SIZE, PINTEREST_BASE, collectPins, requireLimit } from './utils.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

cli({
  site: 'pinterest',
  name: 'search-pins',
  access: 'read',
  description: 'Search pins on Pinterest',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', type: 'string', positional: true, required: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of pins (max ${MAX_LIMIT})` },
  ],
  columns: ['pinId', 'title', 'description', 'pinner', 'board', 'imageUrl', 'url'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) throw new ArgumentError('query is required');

    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}`;

    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const rows = await collectPins(page, {
      resource: 'BaseSearchResource',
      baseOptions: { query, scope: 'pins', appliedProductFilters: '---', auto_correction_disabled: false },
      sourceUrl,
      limit,
      pageSize: DEFAULT_PAGE_SIZE,
    });

    if (rows.length === 0) {
      throw new EmptyResultError('pinterest search-pins', `no pins found for "${query}"`);
    }
    return rows;
  },
});
