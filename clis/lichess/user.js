// lichess user — fetch a public Lichess player profile.
//
// Hits `/api/user/<username>`. Returns the agent-useful slice: handle, title,
// flags (online / patron), counts, top-rated perf, profile bio.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { LICHESS_BASE, formatTimestamp, lichessFetch, requireUsername } from './utils.js';

cli({
    site: 'lichess',
    name: 'user',
    access: 'read',
    description: 'Fetch a Lichess player profile by username (rating, perfs, counts)',
    domain: 'lichess.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'username', positional: true, required: true, help: 'Lichess username (case-insensitive)' },
    ],
    columns: [
        'username',
        'id',
        'title',
        'patron',
        'online',
        'tosViolation',
        'createdAt',
        'seenAt',
        'gamesAll',
        'gamesWin',
        'gamesLoss',
        'gamesDraw',
        'topPerfName',
        'topPerfRating',
        'topPerfGames',
        'fideRating',
        'country',
        'bio',
        'url',
    ],
    func: async (args) => {
        const username = requireUsername(args.username);
        const url = `${LICHESS_BASE}/api/user/${encodeURIComponent(username)}`;
        const body = await lichessFetch(url, 'lichess user');
        if (!body || typeof body !== 'object') {
            throw new EmptyResultError('lichess user', `Lichess user "${username}" returned empty payload.`);
        }
        // Lichess marks closed accounts with `disabled: true` and strips data.
        // Surface as EmptyResultError instead of a row of nulls (silent-fallback).
        if (body.disabled === true) {
            throw new EmptyResultError('lichess user', `Lichess user "${username}" is closed/disabled.`);
        }
        const perfs = body.perfs && typeof body.perfs === 'object' ? body.perfs : {};
        // Pick the perf with the most games (excluding puzzle/storm/racer ephemera).
        const playablePerfs = Object.entries(perfs).filter(([k, v]) => v && typeof v === 'object' && !['puzzle', 'storm', 'racer', 'streak'].includes(k));
        let topPerfName = null;
        let topPerfRating = null;
        let topPerfGames = null;
        for (const [name, p] of playablePerfs) {
            const games = typeof p.games === 'number' ? p.games : 0;
            if (topPerfGames == null || games > topPerfGames) {
                topPerfName = name;
                topPerfGames = games;
                topPerfRating = typeof p.rating === 'number' ? p.rating : null;
            }
        }
        const counts = body.count && typeof body.count === 'object' ? body.count : {};
        const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
        return [{
            username: typeof body.username === 'string' ? body.username : username,
            id: typeof body.id === 'string' ? body.id : null,
            title: typeof body.title === 'string' ? body.title : null,
            patron: body.patron === true,
            online: body.online === true,
            tosViolation: body.tosViolation === true,
            createdAt: formatTimestamp(body.createdAt),
            seenAt: formatTimestamp(body.seenAt),
            gamesAll: typeof counts.all === 'number' ? counts.all : null,
            gamesWin: typeof counts.win === 'number' ? counts.win : null,
            gamesLoss: typeof counts.loss === 'number' ? counts.loss : null,
            gamesDraw: typeof counts.draw === 'number' ? counts.draw : null,
            topPerfName,
            topPerfRating,
            topPerfGames,
            fideRating: typeof profile.fideRating === 'number' ? profile.fideRating : null,
            country: typeof profile.country === 'string' ? profile.country : null,
            bio: typeof profile.bio === 'string' ? profile.bio.trim() : null,
            url: `${LICHESS_BASE}/@/${encodeURIComponent(typeof body.username === 'string' ? body.username : username)}`,
        }];
    },
});
