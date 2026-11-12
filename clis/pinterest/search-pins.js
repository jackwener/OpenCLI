// Pinterest search-pins — search pins by keyword (BaseSearchResource scope=pins|my_pins|videos).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, PIN_ROW_COLUMNS, collectPins, requireLimit } from './utils.js';

const DEFAULT_LIMIT = 25;
// Search pages are slow (~6s per 100 pins); 300 keeps a call well inside the 60s command timeout.
const MAX_LIMIT = 300;
// `my_pins` searches only the logged-in account's pins; `videos` only video pins.
const SCOPES = ['pins', 'my_pins', 'videos'];

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
    { name: 'scope', type: 'string', default: 'pins', choices: SCOPES, help: 'pins (everything), my_pins (your own pins, needs login), or videos' },
  ],
  columns: PIN_ROW_COLUMNS,
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) throw new ArgumentError('query is required');

    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    const scope = String(kwargs.scope ?? 'pins');
    if (!SCOPES.includes(scope)) {
      throw new ArgumentError(`Unknown scope "${scope}". Valid: ${SCOPES.join(', ')}`);
    }
    const sourceUrl = `/search/${scope}/?q=${encodeURIComponent(query)}`;

    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const rows = await collectPins(page, {
      resource: 'BaseSearchResource',
      baseOptions: { query, scope },
      sourceUrl,
      limit,
    });

    if (rows.length === 0) {
      throw new EmptyResultError('pinterest search-pins', `no pins found for "${query}"`);
    }
    return rows;
  },
});
