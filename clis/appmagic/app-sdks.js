// appmagic app-sdks — SDKs / third-party tech detected in an app's binary.
//
// Strategy: PUBLIC_API. Contract: stable. POST /api/v2/applications/sdks with
// the flat {store, storeApplicationID} body (camelCase, same style as
// app-info — NOT an ids array) replays 200 + JSON, no auth.
//
// SOFT PAYWALL, and the nastiest one on this site: anonymously the response
// carries exactly ONE sdk entry while `total_count` reports the truth (33 for
// com.ig.wool.rescue, 22 for com.snapchat.android). It is a 200 with a
// well-formed body — nothing signals that 32 rows were withheld. An adapter
// that returned just the array would present a single SDK as the app's entire
// tech stack, which is worse than returning nothing.
//
// So `sdkTotal` rides on the row and `returned` counts what we actually got.
// When sdkTotal > returned the caller can see the gap in the data itself
// rather than having to know this comment exists.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { APP_STORES, DOMAIN, inferStoreKey, postJson, resolveStore } from './utils.js';

cli({
  site: 'appmagic',
  name: 'app-sdks',
  description: 'SDKs detected in an app. Free tier returns only 1 of sdkTotal — compare those two columns',
  access: 'read',
  example: 'opencli appmagic app-sdks com.ig.wool.rescue',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'appId', type: 'string', required: true, positional: true, help: 'Store app id, e.g. com.ig.wool.rescue or 447188370' },
    { name: 'store', type: 'string', default: '', help: `${APP_STORES.join(' / ')}. Default: inferred from appId` },
  ],
  columns: ['name', 'category', 'firstDetected', 'returned', 'sdkTotal'],
  func: async (args) => {
    const appId = String(args.appId ?? '').trim();
    if (appId === '') throw new ArgumentError('appId must not be empty');

    const storeKey = inferStoreKey(args.store, appId);
    const store = resolveStore(storeKey, { allow: APP_STORES });

    const payload = await postJson('/applications/sdks', { store, storeApplicationID: appId }, 'app-sdks');
    const sdks = Array.isArray(payload?.sdks) ? payload.sdks : [];
    if (sdks.length === 0) {
      throw new EmptyResultError('appmagic app-sdks', `no SDKs detected for ${appId} on ${storeKey}`);
    }

    const total = payload?.total_count ?? null;

    return sdks.map((sdk) => ({
      name: sdk?.name ?? null,
      category: sdk?.category ?? null,
      firstDetected: sdk?.first_detected ?? null,
      returned: sdks.length,
      sdkTotal: total,
    }));
  },
});
