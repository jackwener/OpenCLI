// appmagic app-releases — version history for one app.
//
// Strategy: PUBLIC_API. Contract: stable. POST /api/v2/applications/app-info/releases
// with {store, storeApplicationID, country} replays 200 + JSON, no auth.
// See utils.js for the full note.
//
// Note on release_notes: the store returns whatever locale the publisher shipped
// that version in, so notes for a single app can mix languages across versions.
// They are passed through verbatim rather than filtered to the --country locale.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { APP_STORES, DOMAIN, inferStoreKey, normalizeCountry, normalizeLimit, postJson, resolveStore } from './utils.js';

const MAX_LIMIT = 200;

cli({
  site: 'appmagic',
  name: 'app-releases',
  description: 'App version history (newest first): version, release date, release notes',
  access: 'read',
  example: 'opencli appmagic app-releases 447188370 --limit 10',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'appId', type: 'string', required: true, positional: true, help: 'Store app id, e.g. 447188370 (Apple) or com.whatsapp (Google Play)' },
    { name: 'store', type: 'string', default: '', help: `${APP_STORES.join(' / ')}. Default: inferred from appId` },
    { name: 'country', type: 'string', default: 'US', help: 'ISO country code for the store listing, e.g. US / VN' },
    { name: 'limit', type: 'int', default: 20, help: `Number of versions, newest first (max ${MAX_LIMIT})` },
  ],
  columns: ['version', 'releaseDate', 'releaseNotes'],
  func: async (args) => {
    const appId = String(args.appId ?? '').trim();
    if (appId === '') throw new ArgumentError('appId must not be empty');

    const country = normalizeCountry(args.country, 'US');
    const limit = normalizeLimit(args.limit, 20, MAX_LIMIT);
    const storeKey = inferStoreKey(args.store, appId);
    const store = resolveStore(storeKey, { allow: APP_STORES });

    const payload = await postJson('/applications/app-info/releases', { store, storeApplicationID: appId, country }, 'app-releases');
    const releases = Array.isArray(payload?.releases) ? payload.releases : [];
    if (releases.length === 0) {
      throw new EmptyResultError('appmagic app-releases', `no release history for ${appId} on ${storeKey} in ${country}`);
    }

    // The API returns releases oldest-first; a caller asking for "the latest N
    // versions" means newest-first.
    return releases
      .slice()
      .reverse()
      .slice(0, limit)
      .map((r) => ({
        version: r?.version ?? null,
        releaseDate: r?.release_date ?? null,
        releaseNotes: String(r?.release_notes ?? '').trim() || null,
      }));
  },
});
