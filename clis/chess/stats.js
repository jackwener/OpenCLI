// chess stats — fetch a Chess.com player's statistics and ratings.
//
// Uses the Player endpoint: /pub/player/{username}
// Also fetches per-mode ratings via the stats endpoint.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { CHESS_COM_API, chessComFetch, formatTimestamp, requireUsername } from './utils.js';

cli({
    site: 'chess',
    name: 'stats',
    access: 'read',
    description: 'Get Chess.com player statistics and ratings (bullet/blitz/rapid/classical)',
    domain: 'www.chess.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'username', positional: true, required: true, help: 'Chess.com username' },
    ],
    columns: [
        'username', 'title', 'status', 'joined', 'lastOnline',
        'chessBullet', 'chessBlitz', 'chessRapid', 'chessDaily',
        'tacticsHighest', 'tacticsLowest',
        'puzzleRushBest', 'puzzleRushAvg',
        'gamesAll', 'gamesWon', 'gamesDrawn', 'gamesLost',
        'url',
    ],
    func: async (args) => {
        const username = requireUsername(args.username);

        // Fetch player profile
        const profileUrl = `${CHESS_COM_API}/player/${encodeURIComponent(username)}`;
        let profile;
        try {
            profile = await chessComFetch(profileUrl, 'chess stats');
        }
        catch (err) {
            throw err;
        }

        if (!profile || !profile.username) {
            throw new EmptyResultError('chess stats', `Player "${username}" not found.`);
        }

        // Fetch detailed stats
        const statsUrl = `${CHESS_COM_API}/player/${encodeURIComponent(username)}/stats`;
        let stats = {};
        try {
            stats = await chessComFetch(statsUrl, 'chess stats');
        }
        catch {
            // Stats endpoint might fail for some players, continue with profile only
        }

        // Helper to extract rating from stats
        const getRating = (mode, category) => {
            const modeStats = stats[mode];
            if (!modeStats || typeof modeStats !== 'object') return null;
            const cat = modeStats[category];
            if (!cat || typeof cat !== 'object') return null;
            return cat.rating || null;
        };

        // Helper to get record {games, win, draw, loss}
        const getRecord = (mode) => {
            const modeStats = stats[mode];
            if (!modeStats || typeof modeStats !== 'object') return { games: 0, won: 0, drawn: 0, lost: 0 };
            const rec = modeStats.record || {};
            return {
                games: rec.games || 0,
                won: rec.win || 0,
                drawn: rec.draw || 0,
                lost: rec.loss || 0,
            };
        };

        // Get tactics stats
        const tactics = stats.tactics || {};
        const puzzles = stats.puzzle_rush || {};

        return [{
            username: profile.username,
            title: profile.title || null,
            status: profile.isVerified ? 'verified' : (profile.flair || 'standard'),
            joined: formatTimestamp(profile.joined),
            lastOnline: formatTimestamp(profile.last_online),
            chessBullet: getRating('chess_bullet', 'last') || getRating('chess_bullet', 'best'),
            chessBlitz: getRating('chess_blitz', 'last') || getRating('chess_blitz', 'best'),
            chessRapid: getRating('chess_rapid', 'last') || getRating('chess_rapid', 'best'),
            chessDaily: getRating('chess_daily', 'last') || getRating('chess_daily', 'best'),
            tacticsHighest: tactics.highest || null,
            tacticsLowest: tactics.lowest || null,
            puzzleRushBest: puzzles.best || null,
            puzzleRushAvg: puzzles.average || null,
            gamesAll: (getRecord('chess_bullet').games + getRecord('chess_blitz').games +
                     getRecord('chess_rapid').games + getRecord('chess_daily').games),
            gamesWon: (getRecord('chess_bullet').won + getRecord('chess_blitz').won +
                      getRecord('chess_rapid').won + getRecord('chess_daily').won),
            gamesDrawn: (getRecord('chess_bullet').drawn + getRecord('chess_blitz').drawn +
                        getRecord('chess_rapid').drawn + getRecord('chess_daily').drawn),
            gamesLost: (getRecord('chess_bullet').lost + getRecord('chess_blitz').lost +
                       getRecord('chess_rapid').lost + getRecord('chess_daily').lost),
            url: `https://www.chess.com/member/${username}`,
        }];
    },
});
