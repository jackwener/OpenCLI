// appmagic search — find an app or a publisher by name.
//
// Strategy: PUBLIC_API. Contract: stable. GET /api/v2/search?name=chatgpt&limit=20
// replays 200 + JSON with real results, no auth. See utils.js for the full note.
//
// PERIOD: downloads/revenue here are TRAILING 30 DAYS — not lifetime, and not
// the caller's choice (this endpoint has no period argument). Verified by
// toggling the app page's Last 30 days / Lifetime switch: for
// com.ig.wool.rescue the API's revenue=1 / downloads=10000 render as "< $5,000"
// / "> 10,000" under Last 30 days, while Lifetime shows a different "> $50,000"
// / "> 500,000". The column names are period-neutral by convention across this
// site's adapters, so this comment and the command description are where the
// 30-day window is stated. No adapter here exposes a lifetime figure.
//
// Values are BUCKETED, never exact. Each metric is a min/max pair because the
// site's buckets are open-ended on one side and the direction varies per row —
// see decodeBucket() in utils.js:
//   "> $500,000" -> revenueMin 500000, revenueMax null
//   "< $5,000"   -> revenueMin null,   revenueMax 5000
//   "—"          -> both null (no data)
// Exact figures are premium-only (POST /api/v2/charts/*, 401 even when logged
// in), so they are not available through any adapter here.
//
// The response mixes two entity kinds under one query, so `kind` is the first
// column and rows of both kinds share the schema.
//
// `storeListingCount` is the response's `apps` field, which counts store
// listings, NOT distinct apps: Snapchat reports apps=4 with store_ids
// [2_447188370, 1_com.snapchat.android, 3_447188370, 1_me.sna.android] while
// the site's own header says "3 APPS" (its 3 distinct store_application_ids).
// Hence the explicit name rather than a bare `appCount`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { decodeBucket, DOMAIN, getJson, normalizeLimit } from './utils.js';

const MAX_LIMIT = 100;
const KINDS = ['all', 'app', 'publisher'];

cli({
  site: 'appmagic',
  name: 'search',
  description: 'Search apps and publishers by name. Downloads/revenue are bucketed ranges over the trailing 30 days, not exact and not lifetime',
  access: 'read',
  example: 'opencli appmagic search chatgpt --kind app',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', type: 'string', required: true, positional: true, help: 'App or publisher name to search for' },
    { name: 'kind', type: 'string', default: 'all', help: 'Filter results: all / app / publisher' },
    { name: 'limit', type: 'int', default: 20, help: `Number of results (max ${MAX_LIMIT})` },
  ],
  columns: ['kind', 'id', 'name', 'publisher', 'storeListingCount', 'downloadsMin', 'downloadsMax', 'revenueMin', 'revenueMax', 'headquarter', 'unitedId'],
  func: async (args) => {
    const query = String(args.query ?? '').trim();
    if (query === '') throw new ArgumentError('query must not be empty');

    const kind = String(args.kind ?? 'all').toLowerCase();
    if (!KINDS.includes(kind)) {
      throw new ArgumentError(`Unknown kind "${kind}". Valid: ${KINDS.join(', ')}`);
    }

    const limit = normalizeLimit(args.limit, 20, MAX_LIMIT);

    const payload = await getJson('/search', { name: query, limit }, 'search');

    const rows = [];
    if (kind !== 'publisher') {
      for (const app of payload?.applications ?? []) {
        const downloads = decodeBucket(app?.downloads);
        const revenue = decodeBucket(app?.revenue);
        rows.push({
          kind: 'app',
          id: app?.id ?? null,
          name: app?.name ?? null,
          publisher: app?.unitedPublisher?.name || app?.publisher_name || null,
          storeListingCount: app?.apps ?? null,
          downloadsMin: downloads.min,
          downloadsMax: downloads.max,
          revenueMin: revenue.min,
          revenueMax: revenue.max,
          headquarter: app?.unitedPublisher?.headquarter || null,
          unitedId: app?.id != null ? String(app.id) : null,
        });
      }
    }
    if (kind !== 'app') {
      for (const pub of payload?.publishers ?? []) {
        const downloads = decodeBucket(pub?.downloads);
        const revenue = decodeBucket(pub?.revenue);
        rows.push({
          kind: 'publisher',
          id: pub?.id ?? null,
          name: pub?.name ?? null,
          publisher: null,
          storeListingCount: pub?.apps ?? null,
          downloadsMin: downloads.min,
          downloadsMax: downloads.max,
          revenueMin: revenue.min,
          revenueMax: revenue.max,
          headquarter: pub?.headquarter || null,
          // store_ids look like "2_1684349733" — feed one straight to
          // `opencli appmagic publisher <id>`.
          unitedId: Array.isArray(pub?.store_ids) ? (pub.store_ids[0] ?? null) : null,
        });
      }
    }

    if (rows.length === 0) throw new EmptyResultError('appmagic search', `no ${kind === 'all' ? 'app or publisher' : kind} matches "${query}"`);

    return rows.slice(0, limit);
  },
});
