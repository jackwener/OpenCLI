// steamdb rankings — the leaderboard tables from SteamDB's Menu, unified.
//
// Strategy: DOM_STATE (SSR ranking table) + PAGE_FETCH (per-app hover detail).
// Contract: visible-ui for the table, internal-unstable for RenderAppHover.
// browser:true — SteamDB sits behind Cloudflare, so the real-browser session is
// the reliable path; no anti-bot signature is reverse-engineered. Table parsing
// and hover parsing live in utils.js (shared with rising / hot-tags).
//
//   most-played (/charts/):  Rank | Name | Current | 24h Peak | All-Time Peak
//   stats family (/stats/*): # | Name | % | Price | Rating | Release |
//                            Follows | Online(or Reviews) | Peak
//
// Notes:
//   - `store.price` is major currency units in the Steam region of the
//     logged-in browser (₫ / $ / € ...). Free = 0.
//   - Fields a given ranking does not show are null (most-played has no
//     store.price/rating; top-rated has no currentPlayers). Mirrors the UI.
//   - `detail` (developer/platforms/tags/microtrailer/screenshots/antiCheat)
//     is null unless --detail is passed (1 hover request per game).
//   - /topsellers/ (weekly top sellers) is deliberately excluded: it uses a
//     third, data-sort-free layout with locale-dependent text cells.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cleanRating, DOMAIN, extractTable, fetchDetails, formatDetail, toDate } from './utils.js';

const TYPES = {
    'most-played': '/charts/',
    'top-sellers-global': '/stats/globaltopsellers/',
    'top-rated': '/stats/gameratings/?min_reviews=500',
    'most-followed': '/stats/mostfollowed/',
    'most-wishlisted': '/stats/mostwished/',
    'daily-active': '/stats/dailyactiveusers/',
};
const MAX_LIMIT = 250;

cli({
    site: 'steamdb',
    name: 'rankings',
    description: 'SteamDB Menu leaderboards (most played, top sellers, top rated, most followed/wishlisted, daily active). --detail adds tags/video/etc',
    access: 'read',
    example: 'opencli steamdb rankings --type most-played --limit 25 --detail',
    domain: DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'type', type: 'string', default: 'most-played', help: `Ranking table: ${Object.keys(TYPES).join(' / ')}` },
        { name: 'limit', type: 'int', default: 25, help: `Rows to return (max ${MAX_LIMIT})` },
        { name: 'detail', type: 'bool', default: false, help: 'Enrich each game via its hover card (tags, microtrailer, screenshots, developer, platforms, anti-cheat). 1 request/game' },
    ],
    // Player metrics stay flat (they identify most rankings); store metrics and
    // hover detail are grouped so a row stays <=12 agent-native top-level keys.
    columns: [
        'rank', 'appid', 'name',
        'currentPlayers', 'peak24h', 'peakAllTime',
        'store', 'detail',
    ],
    func: async (page, args) => {
        const type = String(args.type ?? 'most-played').trim().toLowerCase();
        const path = TYPES[type];
        if (!path) {
            throw new ArgumentError(`Unknown --type "${type}". Valid: ${Object.keys(TYPES).join(', ')}`);
        }
        const n = Number(args.limit ?? 25);
        if (!Number.isInteger(n) || n <= 0) throw new ArgumentError('limit must be a positive integer');
        if (n > MAX_LIMIT) throw new ArgumentError(`limit must be <= ${MAX_LIMIT}`);
        const limit = n;
        const wantDetail = args.detail === true || args.detail === 'true';

        const base = await extractTable(page, path);
        if (base.length === 0) {
            // No ranking table usually means a Cloudflare interstitial or a redesign.
            throw new CommandExecutionError(`no ranking table found on ${path} — the page may have shown a challenge or changed layout`);
        }

        const wanted = base.slice(0, limit);
        const detailMap = wantDetail ? await fetchDetails(page, wanted.map((r) => r.appid)) : {};

        return wanted.map((r, i) => ({
            rank: i + 1,
            appid: r.appid,
            name: r.name,
            currentPlayers: r.currentPlayers ?? null,
            peak24h: r.peak24h ?? null,
            peakAllTime: r.peakAllTime ?? null,
            store: {
                price: r.price ?? null,
                discountPct: r.discountPct ?? null,
                rating: cleanRating(r.rating),
                releaseDate: toDate(r.releaseTs),
                follows: r.follows ?? null,
                reviews: r.reviews ?? null,
            },
            detail: formatDetail(detailMap[r.appid] || null),
        }));
    },
});
