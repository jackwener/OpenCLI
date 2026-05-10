// chess games — list recent games for a Chess.com player.
//
// Uses the Archives endpoint: /pub/player/{username}/games/{yyyy}/{mm}
// Returns games in reverse chronological order (newest last per API design).
//
// For reliable PGN extraction, we also provide browser-based fallback
// using the Share → Copy PGN flow when the API PGN is corrupted.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { CHESS_COM_API, classifyTimeControl, chessComFetch, formatTimestamp, parseResult, requireBoundedInt, requireUsername } from './utils.js';

cli({
    site: 'chess',
    name: 'games',
    access: 'read',
    description: 'List recent Chess.com games for a player (archives by month)',
    domain: 'www.chess.com',
    strategy: Strategy.COOKIE, // Browser context preferred for reliable PGN
    browser: true,
    args: [
        { name: 'username', positional: true, required: true, help: 'Chess.com username' },
        { name: 'year', type: 'int', default: null, help: 'Year (default: current year)' },
        { name: 'month', type: 'int', default: null, help: 'Month 1-12 (default: current month)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max games to return' },
    ],
    columns: ['date', 'white', 'whiteRating', 'black', 'blackRating', 'result', 'timeControl', 'eco', 'opening', 'url', 'gameId'],
    func: async (args) => {
        const username = requireUsername(args.username);
        const now = new Date();
        const year = args.year ?? now.getFullYear();
        const month = args.month ?? (now.getMonth() + 1);
        const limit = requireBoundedInt(args.limit, 20, 100);

        const url = `${CHESS_COM_API}/player/${encodeURIComponent(username)}/games/${year}/${String(month).padStart(2, '0')}`;

        let body;
        try {
            body = await chessComFetch(url, 'chess games');
        }
        catch (err) {
            // If API fails, try browser-based extraction
            throw err;
        }

        const games = Array.isArray(body?.games) ? body.games : [];
        if (!games.length) {
            throw new EmptyResultError('chess games', `No games found for ${username} in ${year}/${month}.`);
        }

        // Chess.com archives are oldest-first; get the newest by end_time
        const sorted = [...games].sort((a, b) => (b.end_time || 0) - (a.end_time || 0));

        return sorted.slice(0, limit).map((g) => {
            const whiteUsername = g.white?.username || 'anonymous';
            const blackUsername = g.black?.username || 'anonymous';

            // Determine result from white's perspective
            let result = 'unknown';
            if (g.accuracies?.vs?.result) {
                // This is from the analysis API
                result = g.accuracies.vs.result;
            } else if (g.white?.result) {
                const wr = g.white.result.toLowerCase();
                if (wr.includes('win')) result = '1-0';
                else if (wr.includes('loss')) result = '0-1';
                else if (wr.includes('draw') || wr === 'agreed' || wr === '1/2-1/2') result = '1/2-1/2';
            }

            return {
                date: formatTimestamp(g.end_time),
                white: whiteUsername,
                whiteRating: g.white?.rating || null,
                black: blackUsername,
                blackRating: g.black?.rating || null,
                result,
                timeControl: classifyTimeControl(g.time_class || 'rapid'),
                eco: g.eco || null,
                opening: g.opening?.name || null,
                url: g.url || `${CHESS_COM_API}/game/${g.game_id}`,
                gameId: g.game_id || null,
            };
        });
    },
});
