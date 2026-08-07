import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { BASE, absolutizeUrl, assertRequiredFields, extractIdFromUrl, gotoAndWait, normalizeLimit } from './utils.js';

const RESULT_TYPES = ['player', 'team', 'event', 'article'];

cli({
  site: 'hltv',
  name: 'search',
  description: 'Search HLTV players, teams, events, and articles',
  access: 'read',
  example: 'opencli hltv search niko --limit 10 -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', type: 'string', positional: true, required: true, help: 'Search keyword, e.g. niko' },
    { name: 'limit', type: 'int', default: 10, help: 'Maximum rows per result type (max 50)' },
  ],
  columns: ['rank', 'type', 'id', 'name', 'title', 'date', 'author', 'url'],
  func: async (page, args) => {
    const query = String(args.query ?? '').trim();
    if (!query) throw new ArgumentError('query is required');
    const limit = normalizeLimit(args.limit, 10, 50);
    const url = new URL('/search', BASE);
    url.searchParams.set('query', query);

    await gotoAndWait(page, url, 'table', 'hltv search page');

    const rows = await page.evaluate((payload) => {
      const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
      const absolutize = (value) => (value ? new URL(value, payload.base).toString() : null);
      const extractId = (value, kind) => {
        if (!value) return null;
        const path = new URL(value, payload.base).pathname;
        const patterns = {
          player: /^\/player\/(\d+)\//,
          team: /^\/team\/(\d+)\//,
          event: /^\/events\/(\d+)\//,
          article: /^\/news\/(\d+)\//,
        };
        const match = path.match(patterns[kind]);
        return match ? match[1] : null;
      };

      const out = [];
      for (const table of document.querySelectorAll('table')) {
        const header = clean(table.querySelector('tr')?.innerText);
        let type = null;
        if (/^Player$/i.test(header)) type = 'player';
        if (/^Team$/i.test(header)) type = 'team';
        if (/^Event$/i.test(header)) type = 'event';
        if (/^Article\b/i.test(header)) type = 'article';
        if (!type) continue;

        let rank = 0;
        for (const tr of [...table.querySelectorAll('tr')].slice(1)) {
          if (rank >= payload.limit) break;
          const cells = [...tr.children];
          const firstLink = cells[0]?.querySelector('a[href]');
          const itemUrl = absolutize(firstLink?.getAttribute('href'));
          const firstText = clean(firstLink?.innerText || cells[0]?.innerText);
          if (!firstText || !itemUrl) continue;
          rank += 1;

          if (type === 'article') {
            const authorLink = cells[2]?.querySelector('a[href]');
            out.push({
              rank,
              type,
              id: extractId(itemUrl, type),
              name: null,
              title: firstText,
              date: clean(cells[1]?.innerText) || null,
              author: clean(authorLink?.innerText || cells[2]?.innerText) || null,
              url: itemUrl,
            });
          } else {
            out.push({
              rank,
              type,
              id: extractId(itemUrl, type),
              name: firstText,
              title: null,
              date: null,
              author: null,
              url: itemUrl,
            });
          }
        }
      }
      return out.filter((row) => payload.types.includes(row.type));
    }, { base: BASE, limit, types: RESULT_TYPES });

    return assertRequiredFields(rows.map((row) => ({
      rank: row.rank,
      type: row.type,
      id: row.id ?? extractIdFromUrl(row.url, row.type),
      name: row.name,
      title: row.title,
      date: row.date,
      author: row.author,
      url: absolutizeUrl(row.url),
    })), 'hltv search', ['rank', 'type', 'id', 'url']);
  },
});
