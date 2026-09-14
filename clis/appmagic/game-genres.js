// appmagic game-genres — how crowded a game genre is, broken down by sub-genre.
//
// Strategy: PUBLIC_API. Contract: stable. GET /api/v2/tags/apps-count?tags=<id>
// returns, for the queried tag, the count of apps that ALSO carry each co-tag
// (plus a single-element entry that is the genre's own total). Cross-referenced
// against GET /api/v2/tags for names/types. See utils.js for the full note.
//
// This is market-SATURATION intelligence: it answers "how many games exist in
// this genre, and which sub-genres are the most crowded" — the supply side a
// studio weighs before entering a space. It is a COUNT of apps, not downloads or
// revenue: AppMagic's genre revenue/download SIZE (and its trend over time) is
// premium-only (POST /api/v2/charts/tags -> 401). So this tells you how
// contested a genre is, not how much money is in it.
//
// Counts OVERLAP by design — an app carries many tags at once — so sharePct
// (sub-genre count / genre total) is a crowdedness indicator, not a partition
// that sums to 100%. Pair this with game-competitors (who leads a genre) and
// game-risers (who is climbing) for the full picture.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, GAMES_DOMAIN_TAG, getJson, normalizeLimit, resolveTag } from './utils.js';

const MAX_LIMIT = 100;

cli({
  site: 'appmagic',
  name: 'game-genres',
  description: 'Genre saturation map: how many games each sub-genre holds (supply/crowdedness, by app count — not revenue)',
  access: 'read',
  example: 'opencli appmagic game-genres --genre Puzzle',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'genre', type: 'string', default: '', help: 'Genre tag id or name (e.g. "Puzzle", "Racing"). Default: all games (top-level genre map)' },
    { name: 'limit', type: 'int', default: 30, help: `Number of sub-genres (max ${MAX_LIMIT})` },
  ],
  columns: ['genre', 'subGenre', 'tagId', 'appCount', 'sharePct', 'genreTotal'],
  func: async (args) => {
    const limit = normalizeLimit(args.limit, 30, MAX_LIMIT);

    const genreInput = String(args.genre ?? '').trim();
    const genre = genreInput !== ''
      ? { id: Number(await resolveTag(genreInput)), name: genreInput }
      : { ...GAMES_DOMAIN_TAG };

    // Index the taxonomy so co-tag ids become names + types.
    const catalog = await getJson('/tags', {}, 'game-genres taxonomy');
    const byId = new Map();
    for (const t of (Array.isArray(catalog?.data) ? catalog.data : [])) byId.set(Number(t.id), t);

    // The genre's display name from the catalog is more reliable than the raw input.
    const genreTag = byId.get(genre.id);
    const genreName = genreTag?.name ?? genre.name;

    const counts = await getJson('/tags/apps-count', { tags: genre.id }, `game-genres count ${genre.id}`);
    const rows = Array.isArray(counts?.data) ? counts.data : [];
    if (rows.length === 0) {
      throw new EmptyResultError('appmagic game-genres', `no saturation data for genre "${genreName}"`);
    }

    // The single-element entry [genreId] is the genre's own total app count.
    const totalEntry = rows.find((r) => Array.isArray(r?.tags) && r.tags.length === 1 && Number(r.tags[0]) === genre.id);
    const genreTotal = totalEntry?.count ?? null;

    // Two-tag entries pair the genre with a co-tag; keep only games-type co-tags
    // (the sub-genres) and exclude the genre paired with itself.
    const subGenres = [];
    for (const r of rows) {
      if (!Array.isArray(r?.tags) || r.tags.length !== 2) continue;
      const otherId = Number(r.tags.find((id) => Number(id) !== genre.id));
      const tag = byId.get(otherId);
      if (tag?.type !== 'games') continue;
      subGenres.push({
        genre: genreName,
        subGenre: tag.name,
        tagId: otherId,
        appCount: r.count ?? null,
        sharePct: genreTotal && r.count != null ? Math.round((r.count / genreTotal) * 1000) / 10 : null,
        genreTotal,
      });
    }

    if (subGenres.length === 0) {
      throw new EmptyResultError('appmagic game-genres', `"${genreName}" has no games sub-genres — try a broader genre (e.g. Puzzle, Racing) or Games`);
    }

    subGenres.sort((a, b) => (b.appCount ?? 0) - (a.appCount ?? 0));
    return subGenres.slice(0, limit);
  },
});
