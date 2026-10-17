// appmagic app-competitors — the site's Competitors Dashboard for one app.
//
// Strategy: PUBLIC_API. Contract: stable. POST /api/v2/competitors with
// {"ids":[{store, store_application_id}]} replays 200 + JSON, no auth.
// See utils.js for the full note.
//
// SOFT PAYWALL — the reason `competitorTotal` is on every row. A free account
// receives only 3 competitors while `total_count` reports the real number (30
// for com.ig.wool.rescue). The response is a 200, not a 401, so nothing about
// it announces the truncation; the web UI is explicit about it and prints
// "+27 competitors — SEE PRICING" under the same three rows. Carrying
// total_count on each row is what keeps "3 rows" from silently reading as
// "this app has 3 competitors". There is no offset/limit param to page past it.
//
// PERIOD: downloads/revenue here are TRAILING 30 DAYS, matching the UI's
// "Revenue / Last 30 days" column header — not lifetime. The column names are
// period-neutral by convention across this site's adapters, so this comment and
// the command description are where the window is stated. Values are bucketed,
// same encoding as everywhere else — see decodeBucket() in utils.js.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { APP_STORES, decodeBucket, DOMAIN, inferStoreKey, postJson, resolveStore } from './utils.js';

cli({
  site: 'appmagic',
  name: 'app-competitors',
  description: 'Competitors of an app, with trailing-30-day bucketed metrics. Free tier returns only ~3 of competitorTotal — check that column',
  access: 'read',
  example: 'opencli appmagic app-competitors com.ig.wool.rescue',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'appId', type: 'string', required: true, positional: true, help: 'Store app id, e.g. com.ig.wool.rescue or 447188370' },
    { name: 'store', type: 'string', default: '', help: `${APP_STORES.join(' / ')}. Default: inferred from appId` },
  ],
  columns: ['rank', 'name', 'publisher', 'downloadsMin', 'downloadsMax', 'revenueMin', 'revenueMax', 'unitedId', 'competitorTotal'],
  func: async (args) => {
    const appId = String(args.appId ?? '').trim();
    if (appId === '') throw new ArgumentError('appId must not be empty');

    const storeKey = inferStoreKey(args.store, appId);
    const store = resolveStore(storeKey, { allow: APP_STORES });

    const payload = await postJson('/competitors', { ids: [{ store, store_application_id: appId }] }, 'app-competitors');
    const found = Array.isArray(payload?.data?.competitors) ? payload.data.competitors : [];
    if (found.length === 0) {
      throw new EmptyResultError('appmagic app-competitors', `no competitors listed for ${appId} on ${storeKey}`);
    }

    const total = payload?.total_count ?? null;

    return found.map((entry, i) => {
      const app = entry?.application;
      const downloads = decodeBucket(app?.downloads);
      const revenue = decodeBucket(app?.revenue);
      return {
        rank: i + 1,
        name: app?.name ?? null,
        // application.publisher.name comes back empty here; unitedPublisher is
        // the populated one (verified against the UI's publisher labels).
        publisher: app?.unitedPublisher?.name || app?.publisher_name || null,
        downloadsMin: downloads.min,
        downloadsMax: downloads.max,
        revenueMin: revenue.min,
        revenueMax: revenue.max,
        unitedId: app?.id != null ? String(app.id) : null,
        competitorTotal: total,
      };
    });
  },
});
