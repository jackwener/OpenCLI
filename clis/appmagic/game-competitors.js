// appmagic game-competitors — the competitive field around one game.
//
// Strategy: PUBLIC_API. Contract: stable. Composes two public endpoints:
//   POST /api/v2/united-applications/search-by-ids  -> the seed game's genre tags
//   GET  /api/v2/top/united-apps?tag=<genre>        -> the top games in that genre
// See utils.js for the full strategy note.
//
// Why not just app-competitors? That endpoint returns AppMagic's own hand-picked
// list but the free tier caps it at 3 rows (of ~30). This command instead takes
// the seed game's most specific genre and returns the whole genre leaderboard —
// an uncapped view of who you are actually competing against, with each rival's
// install bucket, rank movement, and release date. Use both: app-competitors for
// the tight 3, game-competitors for the broad field.
//
// The genre is auto-detected (the leaf games-type tag on the seed) and echoed in
// the `genre` column so you can re-run with --genre to broaden or narrow it.
// Your own game is flagged with isSeed=true if it appears in the leaderboard.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  APP_STORES, decodeBucket, DOMAIN, getJson, inferStoreKey,
  normalizeCountry, normalizeLimit, pickGamesGenre, postJson, resolveStore, resolveTag,
} from './utils.js';

const CHARTS = { free: 'top_free', grossing: 'top_grossing' };
const MAX_LIMIT = 100;

cli({
  site: 'appmagic',
  name: 'game-competitors',
  description: 'The competitive field around a game: the top games in its genre, with install buckets and rank movement',
  access: 'read',
  example: 'opencli appmagic game-competitors com.ig.wool.rescue --chart grossing',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'appId', type: 'string', required: true, positional: true, help: 'Your game\'s store id, e.g. com.ig.wool.rescue or 447188370' },
    { name: 'store', type: 'string', default: '', help: `${APP_STORES.join(' / ')}. Default: inferred from appId` },
    { name: 'genre', type: 'string', default: '', help: 'Override the auto-detected genre: a tag id or name (e.g. "Block Puzzle"). Discover with: opencli appmagic tags --type games' },
    { name: 'chart', type: 'string', default: 'free', help: 'Rank by: free (downloads) or grossing (revenue)' },
    { name: 'country', type: 'string', default: 'WW', help: 'ISO code or WW' },
    { name: 'date', type: 'string', default: '', help: 'Period start YYYY-MM-DD. Default: current month' },
    { name: 'limit', type: 'int', default: 30, help: `Number of games (max ${MAX_LIMIT})` },
  ],
  columns: ['rank', 'name', 'publisher', 'hq', 'downloadsMin', 'downloadsMax', 'rankChange', 'releaseDate', 'isSeed', 'genre', 'unitedId'],
  func: async (args) => {
    const appId = String(args.appId ?? '').trim();
    if (appId === '') throw new ArgumentError('appId must not be empty');

    const storeKey = inferStoreKey(args.store, appId);
    const store = resolveStore(storeKey, { allow: APP_STORES });

    const chartKey = String(args.chart ?? 'free').toLowerCase();
    const chart = CHARTS[chartKey];
    if (!chart) throw new ArgumentError(`Unknown chart "${chartKey}". Valid: ${Object.keys(CHARTS).join(', ')}`);

    const country = normalizeCountry(args.country);
    const limit = normalizeLimit(args.limit, 30, MAX_LIMIT);

    let date = String(args.date ?? '').trim();
    if (date === '') {
      const now = new Date();
      date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ArgumentError(`date must be YYYY-MM-DD, got "${date}"`);
    }

    // Resolve the seed game and its genre.
    const seed = await postJson('/united-applications/search-by-ids', { ids: [{ store, store_application_id: appId }] }, 'game-competitors seed');
    const seedApp = Array.isArray(seed?.data) ? seed.data[0] : null;
    if (!seedApp?.id) {
      throw new EmptyResultError('appmagic game-competitors', `no game found for ${appId} on ${storeKey}`);
    }
    const seedUnitedId = String(seedApp.id);

    const genreInput = String(args.genre ?? '').trim();
    const genre = genreInput !== ''
      ? { id: await resolveTag(genreInput), name: genreInput }
      : pickGamesGenre(seedApp.tags);

    // Pull the genre leaderboard.
    const payload = await getJson('/top/united-apps', {
      aggregation: 'month', topDepth: limit, store: 5, country, date, tag: genre.id,
    }, `game-competitors genre ${genre.id}`);
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    if (entries.length === 0) {
      throw new EmptyResultError('appmagic game-competitors', `no games ranked in genre "${genre.name}" for ${country} / ${date}`);
    }

    return entries.slice(0, limit).map((entry, i) => {
      const slot = entry?.[chart];
      const app = slot?.application;
      const downloads = decodeBucket(slot?.[chartKey === 'grossing' ? 'revenue' : 'downloads']);
      const unitedId = app?.united_application_id != null ? String(app.united_application_id) : null;
      return {
        rank: i + 1,
        name: app?.name ?? null,
        publisher: app?.publisher?.name ?? null,
        hq: app?.publisher?.headquarter ?? null,
        downloadsMin: downloads.min,
        downloadsMax: downloads.max,
        rankChange: slot?.diff ?? null,
        releaseDate: app?.releaseDate ? String(app.releaseDate).slice(0, 10) : null,
        isSeed: unitedId != null && unitedId === seedUnitedId,
        genre: genre.name,
        unitedId,
      };
    });
  },
});
