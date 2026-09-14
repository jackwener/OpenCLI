// appmagic top-chart-tags — the tags you can slice the charts by, with sizes.
//
// Strategy: PUBLIC_API. Contract: stable. GET /api/v2/tags returns the full
// taxonomy, and each tag's `score` field IS its app count (verified: it equals
// GET /api/v2/tags/apps-count for all 1273 tags present there, and matches the
// number the top-charts filter dropdown prints next to each tag). One call.
//
// This is the discovery companion to `top-charts --tag` and the game commands'
// `--genre`: it lists every tag those flags accept, grouped by the same sections
// the site's filter picker uses (DOMAINS / SUPERGENRES / GAMES / ART STYLES /
// THEMES / FEATURES / IP / SETTINGS / ...), sorted biggest-first so you can see
// which slices are large enough to be worth charting. The appCount doubles as a
// market-saturation read (how many apps carry the tag).
//
// vs the `tags` command: `tags` is a raw id-by-name lookup; this adds the app
// count, the UI group label, a minimum-size filter, and size sorting — the view
// you want when choosing a filter rather than resolving one known name.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, getJson, normalizeLimit } from './utils.js';

// tag `type` -> the section label the top-charts filter dropdown groups it under.
const TYPE_GROUP = {
  domain: 'DOMAINS',
  meta: 'SUPERGENRES',
  games: 'GAMES',
  apps: 'APP CATEGORIES',
  artstyles: 'ART STYLES',
  themes: 'THEMES',
  features: 'FEATURES',
  ip: 'IP',
  settings: 'SETTINGS',
  complexity: 'COMPLEXITY',
};

const TYPES = Object.keys(TYPE_GROUP);
const SORTS = ['size', 'name'];
const MAX_LIMIT = 500;

cli({
  site: 'appmagic',
  name: 'top-chart-tags',
  description: 'Tags you can filter top-charts (--tag) and game commands (--genre) by, with app counts, grouped and sized',
  access: 'read',
  example: 'opencli appmagic top-chart-tags --type games --min-apps 1000',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'type', type: 'string', default: '', help: `Filter by type: ${TYPES.join(' / ')}. Default: all` },
    { name: 'query', type: 'string', default: '', help: 'Name substring, case-insensitive' },
    { name: 'min-apps', type: 'int', default: 0, help: 'Only tags carried by at least this many apps (hide the long tail)' },
    { name: 'sort', type: 'string', default: 'size', help: 'size (most apps first) or name (A-Z)' },
    { name: 'limit', type: 'int', default: 50, help: `Number of tags (max ${MAX_LIMIT})` },
  ],
  columns: ['group', 'type', 'name', 'tagId', 'appCount', 'parentIds'],
  func: async (args) => {
    const limit = normalizeLimit(args.limit, 50, MAX_LIMIT);

    const type = String(args.type ?? '').trim().toLowerCase();
    if (type !== '' && !TYPES.includes(type)) {
      throw new ArgumentError(`Unknown type "${type}". Valid: ${TYPES.join(', ')}`);
    }

    const query = String(args.query ?? '').trim().toLowerCase();

    const minApps = Number(args['min-apps'] ?? 0);
    if (!Number.isInteger(minApps) || minApps < 0) throw new ArgumentError('min-apps must be a non-negative integer');

    const sort = String(args.sort ?? 'size').toLowerCase();
    if (!SORTS.includes(sort)) throw new ArgumentError(`Unknown sort "${sort}". Valid: ${SORTS.join(', ')}`);

    const catalog = await getJson('/tags', {}, 'top-chart-tags');
    let all = Array.isArray(catalog?.data) ? catalog.data : [];
    if (all.length === 0) throw new EmptyResultError('appmagic top-chart-tags', 'tag catalog is empty');

    // Only keep tag types the top-charts filter actually groups by (excludes
    // internal/analytics tag types that are not offered as chart filters).
    all = all.filter((t) => TYPE_GROUP[t?.type] !== undefined);

    if (type !== '') all = all.filter((t) => t.type === type);
    if (query !== '') all = all.filter((t) => String(t?.name ?? '').toLowerCase().includes(query));
    if (minApps > 0) all = all.filter((t) => Number(t?.score ?? 0) >= minApps);

    if (all.length === 0) {
      const filters = [type && `type "${type}"`, query && `query "${query}"`, minApps > 0 && `>= ${minApps} apps`].filter(Boolean).join(' + ');
      throw new EmptyResultError('appmagic top-chart-tags', `no filter tag matches ${filters}`);
    }

    all.sort(sort === 'name'
      ? (a, b) => String(a.name).localeCompare(String(b.name))
      : (a, b) => Number(b?.score ?? 0) - Number(a?.score ?? 0));

    return all.slice(0, limit).map((t) => ({
      group: TYPE_GROUP[t.type],
      type: t.type,
      name: t.name ?? null,
      tagId: t.id ?? null,
      // score is the app count carrying this tag (verified == tags/apps-count).
      appCount: t.score ?? null,
      // '-'-joined parent tag ids; '' means a root/top-level filter.
      parentIds: String(t?.parent_ids ?? '') || null,
    }));
  },
});
