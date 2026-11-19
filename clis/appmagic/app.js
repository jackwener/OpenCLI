// appmagic app — store listing detail for one app.
//
// Strategy: PUBLIC_API. Contract: stable. POST /api/v2/applications/app-info
// with {store, storeApplicationID, country} replays 200 + JSON, no auth.
// See utils.js for the full note.
//
// The store id is the one in the appmagic URL: /iphone/snapchat/447188370 ->
// 447188370 (Apple), /google-play/whatsapp-messenger/com.whatsapp ->
// com.whatsapp (Google). Find one with `opencli appmagic search <name>`.
// Version history lives in the sibling `app-releases` command.
//
// Deliberately omitted: the response's `downloads` field. It is always 0 on a
// free account — a premium-gated value, not a real zero — so surfacing it would
// silently read as "this app has no downloads". Bucketed lifetime figures are
// available from `opencli appmagic search` instead.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { APP_STORES, DOMAIN, inferStoreKey, normalizeCountry, postJson, resolveStore } from './utils.js';

cli({
  site: 'appmagic',
  name: 'app',
  description: 'App store listing: publisher, price, rating, release date, store URL',
  access: 'read',
  example: 'opencli appmagic app 447188370 --country US',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'appId', type: 'string', required: true, positional: true, help: 'Store app id, e.g. 447188370 (Apple) or com.whatsapp (Google Play)' },
    { name: 'store', type: 'string', default: '', help: `${APP_STORES.join(' / ')}. Default: inferred from appId` },
    { name: 'country', type: 'string', default: 'US', help: 'ISO country code for the store listing, e.g. US / VN' },
  ],
  // Capped at the 12-key row-shape convention. `subtitle` and the `free` flag
  // are the two that lost the cut: subtitle is marketing copy, and free is just
  // price === 0.
  columns: ['name', 'publisher', 'store', 'country', 'price', 'currency', 'rating', 'reviewCount', 'released', 'containsAds', 'hasInAppPurchases', 'url'],
  func: async (args) => {
    const appId = String(args.appId ?? '').trim();
    if (appId === '') throw new ArgumentError('appId must not be empty');

    const country = normalizeCountry(args.country, 'US');
    const storeKey = inferStoreKey(args.store, appId);
    const store = resolveStore(storeKey, { allow: APP_STORES });

    const payload = await postJson('/applications/app-info', { store, storeApplicationID: appId, country }, 'app');
    const app = payload?.data;
    if (!app || app.name == null) {
      throw new EmptyResultError('appmagic app', `no listing for ${appId} on ${storeKey} in ${country}`);
    }

    return [{
      name: app.name,
      publisher: app.publisher_name || null,
      store: storeKey,
      country: app.country ?? country,
      price: app.price ?? null,
      currency: app.currency || null,
      rating: app.rating ?? null,
      reviewCount: app.reviews ?? null,
      released: app.released ?? null,
      containsAds: app.contains_ads ?? null,
      hasInAppPurchases: app.has_in_app_purchases ?? null,
      url: app.application_url || null,
    }];
  },
});
