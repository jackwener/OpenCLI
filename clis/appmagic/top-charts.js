// appmagic top-charts — app ranking: top free / top grossing / top featuring.
//
// Strategy: PUBLIC_API. Contract: stable. See utils.js for the full note.
// Evidence: GET /api/v2/top/united-apps?aggregation=month&topDepth=100&store=5
// &country=WW&date=2026-07-01 replays 200 + JSON with real data, no auth.
//
// Metric availability (probed 2026-07-17, identical anonymous and logged in).
// The API returns the downloads/revenue/featuring fields ONLY for:
//   store=all AND country=WW AND aggregation in {month, year}
// Every other combination (any single store, any single country, day/week/
// quarter) returns the ranking with the metric field absent entirely. That is
// an API characteristic, not an auth failure and not a parse bug, so the metric
// columns report null rather than a faked or clamped number. Ranks themselves
// are valid for every combination.
//
// Downloads/revenue are BUCKETED, not exact: the web UI renders these very
// numbers as "> 20,000,000" / "> $50,000,000", and ranks 1-5 all report an
// identical 20000000. They are reported as a min/max pair because the bucket is
// open-ended on one side and the direction varies per row — see decodeBucket()
// in utils.js. Exact time series lives behind POST /api/v2/charts/applications,
// which is 401 even for a logged-in free account.
// `featuring` is a real exact count, not a bucket.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { decodeBucket, DOMAIN, getJson, normalizeCountry, normalizeLimit, resolveStore, resolveTag } from './utils.js';

const AGGREGATIONS = ['day', 'week', 'month', 'quarter', 'year'];
const MAX_TOP_DEPTH = 100; // topDepth=200 and above -> HTTP 400

function pickApp(entry) {
  const app = entry?.application;
  return {
    name: app?.name ?? null,
    publisher: app?.publisher?.name ?? null,
  };
}

cli({
  site: 'appmagic',
  name: 'top-charts',
  description: 'App rankings: top free / top grossing / top featuring. Downloads and revenue are bucketed lower bounds',
  access: 'read',
  example: 'opencli appmagic top-charts --tag Messenger --limit 20',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'store', type: 'string', default: 'all', help: 'all / ios / iphone / ipad / google-play. Metrics only present for "all"' },
    { name: 'country', type: 'string', default: 'WW', help: 'ISO code, e.g. US / VN / JP. WW = worldwide. Metrics only present for WW' },
    { name: 'date', type: 'string', default: '', help: 'Period start, YYYY-MM-DD. Default: current month' },
    { name: 'aggregation', type: 'string', default: 'month', help: 'day / week / month / quarter / year. Metrics only present for month / year' },
    { name: 'tag', type: 'string', default: '', help: 'Filter by one tag id or name, e.g. 104 or "Messenger". Discover with: opencli appmagic tags' },
    { name: 'limit', type: 'int', default: 20, help: `Number of ranks (max ${MAX_TOP_DEPTH})` },
  ],
  columns: [
    'rank',
    'freeApp', 'freePublisher', 'downloadsMin', 'downloadsMax',
    'grossingApp', 'grossingPublisher', 'revenueMin', 'revenueMax',
    'featuringApp', 'featuringPublisher', 'featuring',
  ],
  func: async (args) => {
    const store = resolveStore(args.store ?? 'all');
    const country = normalizeCountry(args.country);
    const limit = normalizeLimit(args.limit, 20, MAX_TOP_DEPTH);

    const aggregation = String(args.aggregation ?? 'month').toLowerCase();
    if (!AGGREGATIONS.includes(aggregation)) {
      throw new ArgumentError(`Unknown aggregation "${aggregation}". Valid: ${AGGREGATIONS.join(', ')}`);
    }

    let date = String(args.date ?? '').trim();
    if (date === '') {
      const now = new Date();
      date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ArgumentError(`date must be YYYY-MM-DD, got "${date}"`);
    }

    const params = { aggregation, topDepth: limit, store, country, date };

    const tagInput = String(args.tag ?? '').trim();
    if (tagInput !== '') {
      // Only one tag is honoured: `tag=104,101` and a repeated tag param both
      // return output byte-identical to `tag=104` alone, so extra values would
      // be silently dropped. Reject instead of pretending to filter.
      if (/[,;]/.test(tagInput)) {
        throw new ArgumentError('tag accepts a single tag only — the API silently ignores extra tags');
      }
      params.tag = await resolveTag(tagInput);
    }

    const payload = await getJson('/top/united-apps', params, 'top-charts');
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    if (entries.length === 0) {
      throw new EmptyResultError('appmagic top-charts', `no ranking for ${country} / ${aggregation} / ${date}${tagInput ? ` / tag ${tagInput}` : ''}`);
    }

    return entries.slice(0, limit).map((entry, i) => {
      const free = pickApp(entry?.top_free);
      const grossing = pickApp(entry?.top_grossing);
      const featuring = pickApp(entry?.top_featuring);
      const downloads = decodeBucket(entry?.top_free?.downloads);
      const revenue = decodeBucket(entry?.top_grossing?.revenue);
      return {
        rank: i + 1,
        freeApp: free.name,
        freePublisher: free.publisher,
        downloadsMin: downloads.min,
        downloadsMax: downloads.max,
        grossingApp: grossing.name,
        grossingPublisher: grossing.publisher,
        revenueMin: revenue.min,
        revenueMax: revenue.max,
        featuringApp: featuring.name,
        featuringPublisher: featuring.publisher,
        featuring: entry?.top_featuring?.featuring ?? null,
      };
    });
  },
});
