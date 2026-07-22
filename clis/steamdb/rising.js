// steamdb rising — games gaining community attention fastest, hot -> cold.
//
// The signal is SteamDB's `7d Gain` column: net followers/wishlists added in
// the last 7 days. It is the leading indicator of "a game the community is
// turning toward right now", and exists for released and unreleased titles.
//
// Strategy: DOM_STATE + PAGE_FETCH (see utils.js). browser:true (Cloudflare).
//
// Sources per --phase (each is a data-sort table; we re-sort by 7d Gain because
// neither page is sorted by it):
//   upcoming      -> /upcoming/                (300 unreleased games)
//   all / released / new-releases
//                 -> /stats/wishlistactivity/  (top ~100 wishlist movers, mixed)
//
// HONEST LIMIT: each page loads a fixed top set (100 / 300 rows) that is NOT
// ordered by 7d Gain, so we surface the hottest *within that loaded set*. A
// climber outside it (e.g. a low-follower game with a sudden spike that did not
// make the page's default cut) is not visible. For released momentum measured
// in PLAYERS rather than wishlists, use `steamdb player-gainers`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    buildCohort, cleanRating, DOMAIN, extractTable, fetchDetails, formatDetail, RISING_SOURCES, toDate,
} from './utils.js';

const PHASES = Object.keys(RISING_SOURCES);
const MAX_LIMIT = 250;

cli({
    site: 'steamdb',
    name: 'rising',
    description: 'Games gaining community attention fastest by 7-day follower/wishlist gain, hot->cold. Phases: released / upcoming / new-releases / all',
    access: 'read',
    example: 'opencli steamdb rising --phase upcoming --limit 20 --detail',
    domain: DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'phase', type: 'string', default: 'all', help: `Which cohort: ${PHASES.join(' / ')}` },
        { name: 'within-days', type: 'int', default: 60, help: 'For --phase new-releases: released within this many days' },
        { name: 'limit', type: 'int', default: 25, help: `Rows to return (max ${MAX_LIMIT})` },
        { name: 'detail', type: 'bool', default: false, help: 'Enrich each game via its hover card (tags/microtrailer/etc). 1 request/game' },
    ],
    columns: [
        'rank', 'appid', 'name', 'storeUrl', 'gain7d', 'follows',
        'status', 'releaseDate', 'currentPlayers', 'store', 'detail',
    ],
    func: async (page, args) => {
        const phase = String(args.phase ?? 'all').trim().toLowerCase();
        const path = RISING_SOURCES[phase];
        if (!path) throw new ArgumentError(`Unknown --phase "${phase}". Valid: ${PHASES.join(', ')}`);

        const n = Number(args.limit ?? 25);
        if (!Number.isInteger(n) || n <= 0) throw new ArgumentError('limit must be a positive integer');
        if (n > MAX_LIMIT) throw new ArgumentError(`limit must be <= ${MAX_LIMIT}`);
        const limit = n;

        const withinDays = Number(args['within-days'] ?? 60);
        if (!Number.isInteger(withinDays) || withinDays <= 0) throw new ArgumentError('within-days must be a positive integer');

        const wantDetail = args.detail === true || args.detail === 'true';
        const now = Math.floor(Date.now() / 1000);

        const rows = await extractTable(page, path);
        if (rows.length === 0) {
            throw new CommandExecutionError(`no table found on ${path} — the page may have shown a challenge or changed layout`);
        }

        const isReleased = (r) => r.releaseTs != null && r.releaseTs <= now;
        const cohort = buildCohort(rows, phase, { withinDays, now });

        if (cohort.length === 0) {
            const extra = phase === 'new-releases' ? ` released in the last ${withinDays} days` : '';
            throw new EmptyResultError('steamdb rising', `no ${phase} games with a 7-day gain figure${extra}`);
        }

        const wanted = cohort.slice(0, limit);
        const detailMap = wantDetail ? await fetchDetails(page, wanted.map((r) => r.appid)) : {};

        return wanted.map((r, i) => ({
            rank: i + 1,
            appid: r.appid,
            name: r.name,
            storeUrl: `https://store.steampowered.com/app/${r.appid}/`,
            gain7d: r.gain7d,
            follows: r.follows ?? null,
            status: isReleased(r) ? 'released' : 'upcoming',
            releaseDate: toDate(r.releaseTs),
            currentPlayers: r.currentPlayers ?? null,
            store: {
                price: r.price ?? null,
                discountPct: r.discountPct ?? null,
                rating: cleanRating(r.rating),
                reviews: r.reviews ?? null,
            },
            detail: formatDetail(detailMap[r.appid] || null),
        }));
    },
});
