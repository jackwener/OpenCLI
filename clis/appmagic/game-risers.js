// appmagic game-risers — fast-climbing ("rising star") games.
//
// Strategy: PUBLIC_API. Contract: stable. GET /api/v2/top/united-apps?tag=<genre>
// then rank client-side by the `diff` field (period-over-period rank change).
// See utils.js for the full strategy note.
//
// HONEST LIMIT — read this before trusting the output. AppMagic's exact
// download/revenue GROWTH between two periods is premium-only: /period-comparison
// /compare, /applications/history, and /charts/* all return 401 on a free
// account (verified). The ONLY growth signal a free account can see is `diff`,
// the app's RANK CHANGE over the selected period. So "rising" here means
// "climbed the chart fast", not "downloads grew X%". A game that jumped +49
// positions this week is climbing hard, but the underlying install/revenue delta
// is not exposed — downloadsMin/Max are still just the coarse period buckets.
//
// The strongest breakout signal combines two public facts: a big positive
// rankChange AND a recent releaseDate. Use --new-within to keep only games
// released in the last N months — a new game already climbing the chart is the
// clearest "rising star" the free tier can identify.
//
// Note on the download/revenue buckets: the API only fills them for
// aggregation=month|year with country=WW (documented in top-charts). At the
// default --period week they come back null — the rank-change is the signal
// there. Run --period month for the coarse bucket alongside the climb.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  decodeBucket, DOMAIN, GAMES_DOMAIN_TAG, getJson,
  normalizeCountry, normalizeLimit, pickGamesGenre, resolveTag,
} from './utils.js';

const CHARTS = { free: 'top_free', grossing: 'top_grossing' };
const SHORT_PERIODS = ['day', 'week', 'month']; // rising = short window; quarter/year dilute it
const SCAN_DEPTH = 100; // top/united-apps caps topDepth at 100
const MAX_LIMIT = 100;

function monthsSince(iso, now) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const months = (now.getUTCFullYear() - then.getUTCFullYear()) * 12 + (now.getUTCMonth() - then.getUTCMonth());
  return months < 0 ? 0 : months;
}

cli({
  site: 'appmagic',
  name: 'game-risers',
  description: 'Fast-climbing games ranked by chart rank-change (the free-tier "rising star" proxy). Add --new-within for breakouts',
  access: 'read',
  example: 'opencli appmagic game-risers --genre Puzzle --period week --new-within 12',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'genre', type: 'string', default: '', help: 'Genre tag id or name (e.g. "Puzzle", "Racing"). Default: all games. List with: opencli appmagic tags --type games' },
    { name: 'period', type: 'string', default: 'week', help: 'Rank-change window: day / week / month. Shorter = more short-term' },
    { name: 'chart', type: 'string', default: 'free', help: 'Which chart to climb: free (downloads) or grossing (revenue)' },
    { name: 'country', type: 'string', default: 'WW', help: 'ISO code or WW' },
    { name: 'date', type: 'string', default: '', help: 'Period date YYYY-MM-DD. Default: latest available' },
    { name: 'new-within', type: 'int', default: 0, help: 'Keep only games released within this many months (0 = no age filter)' },
    { name: 'min-climb', type: 'int', default: 1, help: 'Minimum positive rank-change to include' },
    { name: 'limit', type: 'int', default: 25, help: `Number of risers to return (max ${MAX_LIMIT})` },
  ],
  columns: ['chartRank', 'rankChange', 'name', 'publisher', 'hq', 'genre', 'downloadsMin', 'downloadsMax', 'releaseDate', 'ageMonths', 'unitedId'],
  func: async (args) => {
    const chartKey = String(args.chart ?? 'free').toLowerCase();
    const chart = CHARTS[chartKey];
    if (!chart) throw new ArgumentError(`Unknown chart "${chartKey}". Valid: ${Object.keys(CHARTS).join(', ')}`);

    const period = String(args.period ?? 'week').toLowerCase();
    if (!SHORT_PERIODS.includes(period)) {
      throw new ArgumentError(`Unknown period "${period}". Valid: ${SHORT_PERIODS.join(', ')} (rising is a short-window signal)`);
    }

    const country = normalizeCountry(args.country);
    const limit = normalizeLimit(args.limit, 25, MAX_LIMIT);

    const newWithin = Number(args['new-within'] ?? 0);
    if (!Number.isInteger(newWithin) || newWithin < 0) throw new ArgumentError('new-within must be a non-negative integer (months)');
    const minClimb = Number(args['min-climb'] ?? 1);
    if (!Number.isInteger(minClimb)) throw new ArgumentError('min-climb must be an integer');

    const genreInput = String(args.genre ?? '').trim();
    const genre = genreInput !== ''
      ? { id: await resolveTag(genreInput), name: genreInput }
      : { ...GAMES_DOMAIN_TAG };

    let date = String(args.date ?? '').trim();
    if (date === '') {
      const latest = await getJson('/last-date', {}, 'game-risers last-date');
      date = latest?.lastDate || '';
      if (date === '') throw new EmptyResultError('appmagic game-risers', 'appmagic did not report a latest available date');
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ArgumentError(`date must be YYYY-MM-DD, got "${date}"`);
    }

    const payload = await getJson('/top/united-apps', {
      aggregation: period, topDepth: SCAN_DEPTH, store: 5, country, date, tag: genre.id,
    }, `game-risers genre ${genre.id}`);
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    if (entries.length === 0) {
      throw new EmptyResultError('appmagic game-risers', `no games ranked in "${genre.name}" for ${country} / ${period} / ${date}`);
    }

    const now = new Date();
    const rows = [];
    entries.forEach((entry, i) => {
      const slot = entry?.[chart];
      const app = slot?.application;
      if (!app) return;
      const climb = Number(slot?.diff ?? 0);
      if (!Number.isFinite(climb) || climb < minClimb) return;

      const age = monthsSince(app?.releaseDate, now);
      if (newWithin > 0 && (age == null || age > newWithin)) return;

      const downloads = decodeBucket(slot?.[chartKey === 'grossing' ? 'revenue' : 'downloads']);
      rows.push({
        chartRank: i + 1,
        rankChange: climb,
        name: app?.name ?? null,
        publisher: app?.publisher?.name ?? null,
        hq: app?.publisher?.headquarter ?? null,
        genre: pickGamesGenre(app?.tags).name,
        downloadsMin: downloads.min,
        downloadsMax: downloads.max,
        releaseDate: app?.releaseDate ? String(app.releaseDate).slice(0, 10) : null,
        ageMonths: age,
        unitedId: app?.united_application_id != null ? String(app.united_application_id) : null,
      });
    });

    if (rows.length === 0) {
      const filt = [newWithin > 0 && `released within ${newWithin}mo`, `rank-change >= ${minClimb}`].filter(Boolean).join(', ');
      throw new EmptyResultError('appmagic game-risers', `no games in "${genre.name}" matched (${filt}) for ${period} ending ${date}`);
    }

    // Biggest climbers first; the chart only holds today's top SCAN_DEPTH, so a
    // game must already rank to appear — this surfaces climbers within that set.
    rows.sort((a, b) => b.rankChange - a.rankChange);
    return rows.slice(0, limit);
  },
});
