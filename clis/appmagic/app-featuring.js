// appmagic app-featuring — store featuring placements for one app.
//
// Strategy: PUBLIC_API. Contract: stable. POST /api/v2/featuring replays 200 +
// JSON, no auth, for the latest available date. See utils.js for the full note.
//
// THE DATE IS SERVER-LOCKED TO A SINGLE DAY. The web UI draws a padlock on its
// DATE field, and that padlock is real: only the exact date returned by
// GET /api/v2/last-date responds 200. One day earlier, a week, a month, two
// years, or any future date all return 403. So this command defaults to that
// date and any other value fails as AuthRequiredError rather than pretending
// history is reachable. Anonymous featuring is a one-day snapshot, not a series.
//
// `sort` is not exposed as an argument because the API accepts exactly one
// value, "featuring" (bundle enum @3370623 has a single member); the column
// sorts in the UI are done client-side and never reach the server. Offering a
// --sort flag would imply a choice that does not exist.
//
// An empty result is normal here — most apps have no featuring placements at
// all (com.ig.wool.rescue has none), which is why it is an EmptyResultError and
// not a failure.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { APP_STORES, DOMAIN, getJson, inferStoreKey, normalizeCountry, normalizeLimit, postJson, resolveStore } from './utils.js';

const MAX_LIMIT = 100; // limit=101 -> HTTP 400
const ORDERS = ['desc', 'asc'];

cli({
  site: 'appmagic',
  name: 'app-featuring',
  description: 'Store featuring placements for an app on the latest available date (history is premium-only)',
  access: 'read',
  example: 'opencli appmagic app-featuring com.snapchat.android --country WW',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'appId', type: 'string', required: true, positional: true, help: 'Store app id, e.g. com.snapchat.android or 447188370' },
    { name: 'store', type: 'string', default: '', help: `${APP_STORES.join(' / ')}. Default: inferred from appId` },
    { name: 'country', type: 'string', default: 'WW', help: 'ISO code or WW for worldwide' },
    { name: 'date', type: 'string', default: '', help: 'YYYY-MM-DD. Default and ONLY free value: the latest available date' },
    { name: 'order', type: 'string', default: 'desc', help: 'desc / asc by featuring count' },
    { name: 'limit', type: 'int', default: 25, help: `Number of placements (max ${MAX_LIMIT})` },
  ],
  columns: ['rank', 'country', 'category', 'placement', 'place', 'row', 'depth', 'featuring', 'date'],
  func: async (args) => {
    const appId = String(args.appId ?? '').trim();
    if (appId === '') throw new ArgumentError('appId must not be empty');

    const storeKey = inferStoreKey(args.store, appId);
    const store = resolveStore(storeKey, { allow: APP_STORES });
    const country = normalizeCountry(args.country);
    const limit = normalizeLimit(args.limit, 25, MAX_LIMIT);

    const order = String(args.order ?? 'desc').toLowerCase();
    if (!ORDERS.includes(order)) {
      throw new ArgumentError(`Unknown order "${order}". Valid: ${ORDERS.join(', ')}`);
    }

    const latest = await getJson('/last-date', {}, 'app-featuring last-date');
    const lastDate = latest?.lastDate;
    if (!lastDate) {
      throw new EmptyResultError('appmagic app-featuring', 'appmagic did not report a latest available date');
    }

    let date = String(args.date ?? '').trim();
    if (date === '') {
      date = lastDate;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ArgumentError(`date must be YYYY-MM-DD, got "${date}"`);
    }

    const payload = await postJson('/featuring', {
      app_ids: [{ store, store_application_id: appId }],
      offset: 0,
      limit,
      date,
      order,
      sort: 'featuring',
      country,
      types: null,
    }, `app-featuring for ${date}`);

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (rows.length === 0) {
      throw new EmptyResultError('appmagic app-featuring', `${appId} has no featuring placements in ${country} on ${date}`);
    }

    return rows.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      country: r?.country ?? null,
      category: r?.name ?? null,
      // `path` is the store's breadcrumb to the placement, e.g.
      // "Featured Home > Social networking".
      placement: Array.isArray(r?.path) ? r.path.map((p) => p?.name).filter(Boolean).join(' > ') || null : null,
      place: r?.place ?? null,
      row: r?.row ?? null,
      depth: r?.depth ?? null,
      featuring: r?.featuring ?? null,
      date: r?.date ?? date,
    }));
  },
});
