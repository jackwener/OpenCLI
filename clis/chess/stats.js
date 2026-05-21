/**
 * Chess.com player stats across game kinds (rapid / blitz / bullet /
 * daily / chess960 / etc) via the public stats endpoint.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { chessApi, validateUsername, summarizeStats } from './utils.js';

const KINDS = ['chess_rapid', 'chess_blitz', 'chess_bullet', 'chess_daily', 'chess960_daily', 'chess_daily_960'];

cli({
    site: 'chess',
    name: 'stats',
    access: 'read',
    description: 'Chess.com player ratings + win/loss record across game kinds',
    domain: 'api.chess.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'username', type: 'string', required: true, positional: true, help: 'Chess.com username (case-insensitive)' },
    ],
    columns: ['kind', 'rating_current', 'rating_best', 'wins', 'losses', 'draws'],
    func: async (kwargs) => {
        const username = validateUsername(kwargs.username);
        const stats = await chessApi(`/player/${encodeURIComponent(username)}/stats`);
        const rows = KINDS.map((k) => summarizeStats(stats, k)).filter(Boolean);
        if (rows.length === 0) {
            throw new EmptyResultError(`Chess.com returned no stats for ${username}`);
        }
        return rows;
    },
});
