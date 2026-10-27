// appmagic publisher — publisher profile and portfolio size.
//
// Strategy: PUBLIC_API. Contract: stable. POST /api/v2/united-publishers/search-by-ids
// with {"ids":[{store, store_publisher_id}]} replays 200 + JSON, no auth.
// See utils.js for the full note.
//
// The id is the one in the appmagic URL: /publisher/openai-opco-llc/2_1684349733
// -> pass "2_1684349733". Find one with `opencli appmagic search <name>
// --kind publisher`, whose unitedId column is already in this format.
//
// PERIOD: downloads/revenue here are TRAILING 30 DAYS — NOT lifetime, which the
// site shows behind a separate toggle. The column names are period-neutral by
// convention across this site's adapters, so this comment and the command
// description are where the window is stated.
//
// Values are BUCKETED, and are a min/max pair because the buckets are
// open-ended on one side and the direction varies per row ("> 50,000,000" vs
// "< $5,000" vs "—"). See decodeBucket() in utils.js.
// Exact per-period figures are premium-only (POST /api/v2/charts/publishers
// returns 401 even for a logged-in free account).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { decodeBucket, DOMAIN, STORES, postJson } from './utils.js';

// The publisher id embeds its own store prefix, e.g. "2_1684349733" or
// "1_Meta Platforms, Inc.". The suffix is free-form, so only split on the first
// underscore.
function parsePublisherId(raw) {
  const match = /^(\d+)_(.+)$/s.exec(raw);
  if (!match) {
    throw new ArgumentError(`publisherId must look like "<store>_<id>", e.g. 2_1684349733 — got "${raw}". Find one with: opencli appmagic search <name> --kind publisher`);
  }
  const store = Number(match[1]);
  if (!Object.values(STORES).includes(store)) {
    throw new ArgumentError(`Unknown store prefix "${store}" in "${raw}". Valid prefixes: ${Object.values(STORES).sort().join(', ')}`);
  }
  return { store, store_publisher_id: match[2] };
}

cli({
  site: 'appmagic',
  name: 'publisher',
  description: 'Publisher profile: app count, HQ, LinkedIn headcount. Downloads/revenue are bucketed ranges over the trailing 30 days, not lifetime',
  access: 'read',
  example: 'opencli appmagic publisher 2_1684349733',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'publisherId', type: 'string', required: true, positional: true, help: 'Store-prefixed id from the appmagic URL, e.g. 2_1684349733' },
  ],
  columns: ['id', 'name', 'appCount', 'storeListingCount', 'downloadsMin', 'downloadsMax', 'revenueMin', 'revenueMax', 'headquarter', 'linkedinHeadcount', 'firstReleaseDate', 'url'],
  func: async (args) => {
    const raw = String(args.publisherId ?? '').trim();
    if (raw === '') throw new ArgumentError('publisherId must not be empty');

    const payload = await postJson('/united-publishers/search-by-ids', { ids: [parsePublisherId(raw)] }, 'publisher');
    const found = Array.isArray(payload?.data) ? payload.data : [];
    if (found.length === 0 || !found[0]?.name) {
      throw new EmptyResultError('appmagic publisher', `no publisher matches "${raw}"`);
    }

    return found.map((p) => {
      const downloads = decodeBucket(p?.downloads);
      const revenue = decodeBucket(p?.revenue);
      return {
      id: p?.id ?? null,
      name: p?.name ?? null,
      // `united_apps` is what the site's publisher page labels "Apps" (verified:
      // 3 for OpenAI, matching the UI). `apps` counts store listings instead —
      // 5 for the same publisher — so it gets the explicit name.
      appCount: p?.united_apps ?? null,
      storeListingCount: p?.apps ?? null,
      downloadsMin: downloads.min,
      downloadsMax: downloads.max,
      revenueMin: revenue.min,
      revenueMax: revenue.max,
      headquarter: p?.headquarter || null,
      linkedinHeadcount: p?.linkedin_headcount ?? null,
      firstReleaseDate: p?.min_release_date ?? null,
      url: p?.url || null,
      };
    });
    // Not surfaced: a country count. The page shows "Countries 72" for OpenAI
    // while the response carries countries=161 and dataCountries=118; neither
    // matches, and no field reproduces the UI figure, so reporting one would be
    // a number the site itself contradicts.
  },
});
