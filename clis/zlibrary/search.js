import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { ZLIBRARY_DOMAIN, buildSearchUrl, extractSearchResults } from './utils.js';

cli({
  site: 'zlibrary',
  name: 'search',
  description: 'Search Z-Library for books by title, author, ISBN, or keyword',
  domain: ZLIBRARY_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'query',
      positional: true,
      required: true,
      help: 'Search keyword (title, author, ISBN, etc.)',
    },
    {
      name: 'limit',
      type: 'int',
      default: 10,
      help: 'Max results (1–25)',
    },
  ],
  columns: ['rank', 'title', 'author', 'url'],
  func: async (page, args) => {
    const limit = Math.max(1, Math.min(Number(args.limit) || 10, 25));
    const searchUrl = buildSearchUrl(args.query);

    await page.goto(searchUrl, { waitUntil: 'load', settleMs: 3000 });
    await page.wait({ time: 5 });

    const results = await extractSearchResults(page, limit);

    if (!results.length) {
      throw new CliError(
        'NOT_FOUND',
        'No books found',
        'Try a different keyword or check that you are logged into Z-Library'
      );
    }

    return results;
  },
});
