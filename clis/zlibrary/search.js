import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { buildSearchExtractScript, buildSearchUrls, getMirrors, hostOf, readLimit, readMirror } from './utils.js';

/**
 * Walk the mirror list, trying both search URL shapes, and return the first
 * non-empty result set. Dead mirrors are skipped as soon as the page reports
 * `chrome-error`, so an all-dead network fails in seconds instead of after the
 * full settle time of every attempt.
 *
 * Exported so it can be unit-tested with a fake page.
 */
export async function runSearch(page, { query, limit, mirrors }) {
  const size = readLimit(limit);
  if (!Array.isArray(mirrors) || mirrors.length === 0) {
    throw new ArgumentError('zlibrary mirror list is empty');
  }
  const candidates = mirrors;
  const attempts = [];

  for (const mirror of candidates) {
    for (const url of buildSearchUrls(query, mirror)) {
      let raw;
      try {
        await page.goto(url, { waitUntil: 'load', settleMs: 1500 });
        const probe = JSON.parse(
          (await page.evaluate(`
            JSON.stringify({
              url: location.href,
              nodes: document.querySelectorAll('z-bookcard, div.resItemBox').length
            })
          `)) || '{}',
        );
        if (String(probe.url || '').startsWith('chrome-error')) {
          attempts.push(`${url} -> unreachable`);
          continue;
        }
        if (!probe.nodes) await page.wait({ time: 3 });
        raw = await page.evaluate(buildSearchExtractScript(size));
      } catch (error) {
        attempts.push(`${url} -> ${String((error && error.message) || error).slice(0, 80)}`);
        continue;
      }

      let results = [];
      try {
        results = JSON.parse(raw);
      } catch {
        results = [];
      }
      if (results.length) {
        const host = hostOf(mirror);
        return results.map(row => ({ ...row, mirror: host }));
      }
      attempts.push(`${url} -> 0 rows`);
    }
  }

  throw new EmptyResultError(
    'zlibrary search',
    `No results. Tried: ${attempts.join('; ') || 'no mirrors configured'}`,
  );
}

cli({
  site: 'zlibrary',
  name: 'search',
  access: 'read',
  description: 'Search Z-Library for books by title, author, ISBN, or keyword (tries live mirrors in order)',
  domain: 'z-lib.id',
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
    {
      name: 'mirror',
      help: 'Z-Library mirror host or origin to use instead of the default list',
    },
  ],
  columns: ['rank', 'title', 'author', 'year', 'language', 'format', 'url', 'mirror'],
  func: async (page, args) => {
    const mirrors = args.mirror === undefined || args.mirror === null
      ? getMirrors()
      : [readMirror(args.mirror)];
    return runSearch(page, { query: args.query, limit: args.limit, mirrors });
  },
});
