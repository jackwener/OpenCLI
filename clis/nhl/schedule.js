// nhl schedule — NHL game schedule for the current week (or week starting <date>).
//
// Endpoint:
//   GET /v1/schedule/now            current week
//   GET /v1/schedule/<YYYY-MM-DD>   week starting on <date>
//
// Returns one row per game, sorted by start time ascending. Surfaces
// home/away teams + score + state so post-game / live / pre-game rows are
// visually distinct without needing per-row drilldown.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    NHL_BASE,
    gameTypeLabel,
    nhlFetch,
    pickEn,
    requireBoundedInt,
    requireOptionalDate,
} from './utils.js';

cli({
    site: 'nhl',
    name: 'schedule',
    access: 'read',
    description: 'NHL game schedule for a 7-day window',
    domain: 'api-web.nhle.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'date', help: 'YYYY-MM-DD anchor date (default: now)' },
        { name: 'limit', type: 'int', default: 50, help: 'Max games (1-200, default 50)' },
    ],
    columns: [
        'rank', 'gameId', 'startTime', 'gameDate', 'gameType',
        'awayAbbrev', 'awayName', 'awayScore',
        'homeAbbrev', 'homeName', 'homeScore',
        'venue', 'gameState', 'url',
    ],
    func: async (args) => {
        const date = requireOptionalDate(args.date);
        const limit = requireBoundedInt(args.limit, 50, 200);
        const url = `${NHL_BASE}/v1/schedule/${date ?? 'now'}`;
        const body = await nhlFetch(url, 'nhl schedule');
        const days = Array.isArray(body?.gameWeek) ? body.gameWeek : [];
        const games = [];
        for (const day of days) {
            if (Array.isArray(day?.games)) {
                for (const g of day.games) games.push({ dayDate: day.date, ...g });
            }
        }
        if (!games.length) {
            throw new EmptyResultError('nhl schedule', `NHL returned no games for the week starting "${date ?? 'now'}".`);
        }
        // Sort by startTimeUTC ascending (NHL response is usually already sorted, but
        // make this deterministic so the contract test never flips on a quiet day).
        games.sort((a, b) => {
            const ta = a.startTimeUTC ?? '';
            const tb = b.startTimeUTC ?? '';
            return ta.localeCompare(tb);
        });
        return games.slice(0, limit).map((g, i) => {
            const awayAbbrev = String(g.awayTeam?.abbrev ?? '').trim();
            const homeAbbrev = String(g.homeTeam?.abbrev ?? '').trim();
            return {
                rank: i + 1,
                gameId: g.id != null ? Number(g.id) : null,
                startTime: g.startTimeUTC ? new Date(g.startTimeUTC).toISOString() : null,
                gameDate: g.dayDate ?? g.gameDate ?? null,
                gameType: gameTypeLabel(g.gameType),
                awayAbbrev,
                awayName: pickEn(g.awayTeam?.placeName) || pickEn(g.awayTeam?.name) || awayAbbrev,
                awayScore: g.awayTeam?.score != null ? Number(g.awayTeam.score) : null,
                homeAbbrev,
                homeName: pickEn(g.homeTeam?.placeName) || pickEn(g.homeTeam?.name) || homeAbbrev,
                homeScore: g.homeTeam?.score != null ? Number(g.homeTeam.score) : null,
                venue: pickEn(g.venue),
                gameState: String(g.gameState ?? '').trim(),
                url: g.id ? `https://www.nhl.com/gamecenter/${g.id}` : 'https://www.nhl.com/scores',
            };
        });
    },
});
