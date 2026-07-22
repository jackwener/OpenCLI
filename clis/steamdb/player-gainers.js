// steamdb player-gainers — released games whose CONCURRENT PLAYER COUNT is
// climbing fastest this week, hot -> cold.
//
// This is the released-game momentum signal that `rising` can't see: `rising`
// tracks follower/wishlist gain (great for pre-launch hype), but a game that is
// already out and suddenly surging in players (a patch, a sale, a streamer
// moment) shows up here instead.
//
// How: take the top --scan games from /charts/ (Most Played), pull each game's
// hourly player series from /api/GetGraphWeek/, and compare the average of the
// last 24h against the first 24h of the ~7-day window. Rank by that growth.
//
// Strategy: DOM_STATE (charts table) + PAGE_FETCH (GetGraphWeek JSON,
// same-origin). browser:true (Cloudflare).
//
// HONEST LIMITS:
//   - Only games already in the Most Played top --scan are considered, so this
//     finds "which big game is surging", not a small game breaking out from
//     nowhere (that game isn't on /charts/ yet). For pre-release / wishlist
//     breakouts use `steamdb rising`.
//   - GetGraphWeek rate-limits bursts. One run is fine; back-to-back runs
//     within ~30s may fail — the command then fails FAST with a retryable
//     error instead of returning a silently empty/partial result.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, extractTable, fetchDetails, fetchPlayerMomentum, formatDetail } from './utils.js';

const CHARTS = '/charts/';
const MAX_SCAN = 200;
const MAX_LIMIT = 200;
const BY = ['pct', 'abs'];

cli({
    site: 'steamdb',
    name: 'player-gainers',
    description: 'Released games whose concurrent player count is climbing fastest this week (real GetGraphWeek history), hot->cold',
    access: 'read',
    example: 'opencli steamdb player-gainers --scan 60 --by pct --min-players 2000 --limit 20',
    domain: DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'scan', type: 'int', default: 50, help: `How many Most-Played games to analyze (max ${MAX_SCAN}). 1 request/game` },
        { name: 'by', type: 'string', default: 'pct', help: 'Rank by: pct (relative growth) or abs (absolute player gain)' },
        { name: 'min-players', type: 'int', default: 1000, help: 'Ignore games below this current player count (noise floor for pct)' },
        { name: 'limit', type: 'int', default: 25, help: `Rows to return (max ${MAX_LIMIT})` },
        { name: 'detail', type: 'bool', default: false, help: 'Enrich each game via its hover card (tags/microtrailer/etc). 1 request/game' },
    ],
    columns: [
        'rank', 'appid', 'name', 'growthPct', 'growthAbs',
        'playersNow', 'players7dAgo', 'peakWeek', 'chartRank', 'detail',
    ],
    func: async (page, args) => {
        const scan = Number(args.scan ?? 50);
        if (!Number.isInteger(scan) || scan <= 0) throw new ArgumentError('scan must be a positive integer');
        if (scan > MAX_SCAN) throw new ArgumentError(`scan must be <= ${MAX_SCAN}`);

        const by = String(args.by ?? 'pct').trim().toLowerCase();
        if (!BY.includes(by)) throw new ArgumentError(`Unknown --by "${by}". Valid: ${BY.join(', ')}`);

        const minPlayers = Number(args['min-players'] ?? 1000);
        if (!Number.isInteger(minPlayers) || minPlayers < 0) throw new ArgumentError('min-players must be a non-negative integer');

        const limit = Number(args.limit ?? 25);
        if (!Number.isInteger(limit) || limit <= 0) throw new ArgumentError('limit must be a positive integer');
        if (limit > MAX_LIMIT) throw new ArgumentError(`limit must be <= ${MAX_LIMIT}`);

        const wantDetail = args.detail === true || args.detail === 'true';

        const charts = await extractTable(page, CHARTS);
        if (charts.length === 0) {
            throw new CommandExecutionError(`no Most Played table on ${CHARTS} — the page may have shown a challenge or changed layout`);
        }

        // chartRank is the game's position on Most Played (1-based) before we
        // re-rank by growth.
        const scanned = charts.slice(0, scan).map((r, i) => ({ ...r, chartRank: i + 1 }));
        const { map: momentum, requested, ok, failed } = await fetchPlayerMomentum(page, scanned.map((r) => r.appid));

        // Total fetch failure is throttling, not "no gainers" — say so loudly
        // (retryable) instead of returning a misleading empty result.
        if (ok === 0 && failed > 0) {
            throw new CommandExecutionError(`player history fetch failed for all ${requested} games (likely rate-limited by SteamDB) — retry, or lower --scan`);
        }

        const rows = [];
        for (const r of scanned) {
            const mo = momentum[r.appid];
            if (!mo || mo.playersNow < minPlayers) continue;
            const growthAbs = mo.playersNow - mo.players7dAgo;
            const growthPct = mo.players7dAgo > 0
                ? Math.round((growthAbs / mo.players7dAgo) * 1000) / 10 : null;
            // Ranking by pct needs a defined pct; abs is always defined.
            if (by === 'pct' && growthPct == null) continue;
            rows.push({ ...r, playersNow: mo.playersNow, players7dAgo: mo.players7dAgo, peakWeek: mo.peakWeek, growthAbs, growthPct });
        }

        if (rows.length === 0) {
            throw new EmptyResultError('steamdb player-gainers', `no Most-Played game (scanned ${scanned.length}) had a weekly player series above ${minPlayers} current players`);
        }

        rows.sort((a, b) => (by === 'abs' ? b.growthAbs - a.growthAbs : b.growthPct - a.growthPct));

        const wanted = rows.slice(0, limit);
        const detailMap = wantDetail ? await fetchDetails(page, wanted.map((r) => r.appid)) : {};

        return wanted.map((r, i) => ({
            rank: i + 1,
            appid: r.appid,
            name: r.name,
            growthPct: r.growthPct,
            growthAbs: r.growthAbs,
            playersNow: r.playersNow,
            players7dAgo: r.players7dAgo,
            peakWeek: r.peakWeek,
            chartRank: r.chartRank,
            detail: formatDetail(detailMap[r.appid] || null),
        }));
    },
});
