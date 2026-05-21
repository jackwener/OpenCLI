/**
 * Chess.com recent games from monthly archives. Walks the archive
 * list newest-first and fetches as few months as needed to fill --limit.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { chessApi, validateUsername, mapGameRow } from './utils.js';

const MAX_LIMIT = 100;
const MAX_ARCHIVE_FETCHES = 6;

function parseLimit(value) {
    if (value === undefined || value === null || value === '') return 10;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return limit;
}

cli({
    site: 'chess',
    name: 'games',
    access: 'read',
    description: 'Chess.com recent games for a player, newest first',
    domain: 'api.chess.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'username', type: 'string', required: true, positional: true, help: 'Chess.com username' },
        { name: 'limit', type: 'int', default: 10, help: `Number of recent games (1-${MAX_LIMIT})` },
    ],
    columns: ['date', 'time_class', 'rated', 'my_color', 'my_rating', 'my_result', 'opponent', 'opponent_rating', 'accuracy_white', 'accuracy_black', 'eco', 'opening_name', 'url'],
    func: async (kwargs) => {
        const username = validateUsername(kwargs.username);
        const limit = parseLimit(kwargs.limit);
        const archivesList = await chessApi(`/player/${encodeURIComponent(username)}/games/archives`);
        if (!Array.isArray(archivesList.archives)) {
            throw new CommandExecutionError('Chess.com archives payload is missing archives array');
        }
        const archives = archivesList.archives.slice().reverse();
        if (archives.length === 0) {
            throw new EmptyResultError(`Chess.com has no game archives for ${username}`);
        }
        const rows = [];
        for (let i = 0; i < archives.length && i < MAX_ARCHIVE_FETCHES && rows.length < limit; i++) {
            if (typeof archives[i] !== 'string' || !archives[i].startsWith('https://api.chess.com/pub/player/')) {
                throw new CommandExecutionError('Chess.com archives payload contains an unexpected archive URL');
            }
            const monthly = await chessApi(archives[i]);
            if (!Array.isArray(monthly.games)) {
                throw new CommandExecutionError('Chess.com monthly archive payload is missing games array');
            }
            const games = monthly.games.slice().reverse();
            for (const g of games) {
                rows.push(mapGameRow(g, username));
                if (rows.length >= limit) break;
            }
        }
        if (rows.length === 0) {
            throw new EmptyResultError(`Chess.com has games archives for ${username} but no games in the most recent ${MAX_ARCHIVE_FETCHES} months`);
        }
        return rows.slice(0, limit);
    },
});

export const __test__ = { parseLimit };
