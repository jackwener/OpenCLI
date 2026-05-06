// nhl standings — current NHL league standings (or as-of a given date).
//
// Endpoint:
//   GET /v1/standings/now            (default)
//   GET /v1/standings/<YYYY-MM-DD>   (when --date is supplied)
//
// Returns one row per team, ordered by NHL's published ranking
// (conference→division→points). Surfaces wins/losses/points/PCT plus
// streak + home/road records so a single row stays scannable.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    NHL_BASE,
    nhlFetch,
    pickEn,
    requireBoundedInt,
    requireOptionalDate,
} from './utils.js';

cli({
    site: 'nhl',
    name: 'standings',
    access: 'read',
    description: 'NHL league standings (current or as-of date)',
    domain: 'api-web.nhle.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'date', help: 'YYYY-MM-DD as-of date (default: now)' },
        { name: 'limit', type: 'int', default: 32, help: 'Max teams (1-32, default 32)' },
    ],
    columns: [
        'rank', 'teamAbbrev', 'teamName', 'conference', 'division',
        'gamesPlayed', 'wins', 'losses', 'otLosses', 'points',
        'pointPct', 'goalDiff', 'streakCode', 'streakCount',
        'homeRecord', 'roadRecord', 'l10Record', 'url',
    ],
    func: async (args) => {
        const date = requireOptionalDate(args.date);
        const limit = requireBoundedInt(args.limit, 32, 32);
        const url = `${NHL_BASE}/v1/standings/${date ?? 'now'}`;
        const body = await nhlFetch(url, 'nhl standings');
        const teams = Array.isArray(body?.standings) ? body.standings : [];
        if (!teams.length) {
            throw new EmptyResultError('nhl standings', `NHL returned no standings rows for "${date ?? 'now'}".`);
        }
        return teams.slice(0, limit).map((t, i) => {
            const abbrev = String(t.teamAbbrev?.default ?? t.teamAbbrev ?? '').trim();
            const homeWins = t.homeWins ?? 0;
            const homeLosses = t.homeLosses ?? 0;
            const homeOT = t.homeOtLosses ?? 0;
            const roadWins = t.roadWins ?? 0;
            const roadLosses = t.roadLosses ?? 0;
            const roadOT = t.roadOtLosses ?? 0;
            const l10Wins = t.l10Wins ?? 0;
            const l10Losses = t.l10Losses ?? 0;
            const l10OT = t.l10OtLosses ?? 0;
            return {
                rank: i + 1,
                teamAbbrev: abbrev,
                teamName: pickEn(t.teamName),
                conference: String(t.conferenceName ?? '').trim(),
                division: String(t.divisionName ?? '').trim(),
                gamesPlayed: t.gamesPlayed != null ? Number(t.gamesPlayed) : null,
                wins: t.wins != null ? Number(t.wins) : null,
                losses: t.losses != null ? Number(t.losses) : null,
                otLosses: t.otLosses != null ? Number(t.otLosses) : null,
                points: t.points != null ? Number(t.points) : null,
                pointPct: t.pointPctg != null ? Number(t.pointPctg) : null,
                goalDiff: t.goalDifferential != null ? Number(t.goalDifferential) : null,
                streakCode: t.streakCode ? String(t.streakCode) : null,
                streakCount: t.streakCount != null ? Number(t.streakCount) : null,
                homeRecord: `${homeWins}-${homeLosses}-${homeOT}`,
                roadRecord: `${roadWins}-${roadLosses}-${roadOT}`,
                l10Record: `${l10Wins}-${l10Losses}-${l10OT}`,
                url: abbrev ? `https://www.nhl.com/${abbrev.toLowerCase()}/` : 'https://www.nhl.com/standings',
            };
        });
    },
});
