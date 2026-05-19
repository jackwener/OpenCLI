/**
 * Shared helpers for the public Chess.com REST API
 * (https://api.chess.com/pub/). No auth, no rate-limit headers.
 */
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const API_BASE = 'https://api.chess.com/pub';
export const UA = 'Mozilla/5.0 (compatible; opencli/1.0)';

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,25}$/;

export function validateUsername(value) {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) throw new ArgumentError('<username> is required');
    if (!USERNAME_RE.test(s)) {
        throw new ArgumentError(`Invalid Chess.com username "${value}"`, 'Usernames are 3-25 chars: a-z, 0-9, hyphen, underscore.');
    }
    return s;
}

export async function chessApi(path, fetchImpl = fetch) {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const resp = await fetchImpl(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (resp.status === 404) throw new EmptyResultError(`Chess.com returned 404 for ${url}`);
    if (!resp.ok) throw new CommandExecutionError(`Chess.com API returned HTTP ${resp.status} for ${url}`);
    return resp.json();
}

/** Pull rating + record fields out of a stats sub-object (`chess_rapid` etc). */
export function summarizeStats(stats, kind) {
    const k = stats?.[kind];
    if (!k) return null;
    const record = k.record || {};
    return {
        kind: kind.replace(/^chess_/, ''),
        rating_current: k.last?.rating ?? '',
        rating_best: k.best?.rating ?? '',
        wins: record.win ?? '',
        losses: record.loss ?? '',
        draws: record.draw ?? '',
    };
}

/** Parse an end_time epoch (seconds) into YYYY-MM-DD. */
export function formatDate(epochSeconds) {
    if (!epochSeconds || typeof epochSeconds !== 'number') return '';
    return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Map a Chess.com game record (from the monthly archive) to a flat row.
 * The viewer perspective controls win/loss orientation.
 */
export function mapGameRow(game, viewerUsername) {
    const white = game?.white || {};
    const black = game?.black || {};
    const viewerLower = String(viewerUsername || '').toLowerCase();
    const viewerIsWhite = String(white.username || '').toLowerCase() === viewerLower;
    const me = viewerIsWhite ? white : black;
    const opp = viewerIsWhite ? black : white;
    return {
        date: formatDate(game?.end_time),
        time_class: game?.time_class || '',
        rated: game?.rated === true,
        my_color: viewerIsWhite ? 'white' : 'black',
        my_rating: me?.rating ?? '',
        my_result: me?.result || '',
        opponent: opp?.username || '',
        opponent_rating: opp?.rating ?? '',
        eco: game?.eco || '',
        url: game?.url || '',
    };
}

export const __test__ = {
    validateUsername,
    summarizeStats,
    formatDate,
    mapGameRow,
};
