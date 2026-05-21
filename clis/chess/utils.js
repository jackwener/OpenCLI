/**
 * Shared helpers for the public Chess.com REST API
 * (https://api.chess.com/pub/). No auth, no rate-limit headers.
 */
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const API_BASE = 'https://api.chess.com/pub';
export const UA = 'Mozilla/5.0 (compatible; opencli/1.0)';

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,25}$/;
const GAME_URL_RE = /^https:\/\/www\.chess\.com\/game\/(live|daily)\/(\d+)/i;

export function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalPlainObject(value) {
    return value === undefined || value === null || isPlainObject(value);
}

export function validateUsername(value) {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) throw new ArgumentError('<username> is required');
    if (!USERNAME_RE.test(s)) {
        throw new ArgumentError(`Invalid Chess.com username "${value}"`, 'Usernames are 3-25 chars: a-z, 0-9, hyphen, underscore.');
    }
    return s;
}

export function parseGameUrl(value) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError('<game-url> is required');
    const m = s.match(GAME_URL_RE);
    if (!m) {
        throw new ArgumentError(
            `Invalid Chess.com game URL: "${value}"`,
            'Expected https://www.chess.com/game/live/<id> or https://www.chess.com/game/daily/<id>.',
        );
    }
    return { kind: m[1].toLowerCase(), id: m[2] };
}

export async function chessApi(path, fetchImpl = fetch) {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    let resp;
    try {
        resp = await fetchImpl(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (error) {
        throw new CommandExecutionError(`Failed to fetch Chess.com API ${url}: ${error?.message || error}`);
    }
    if (!resp || typeof resp !== 'object') {
        throw new CommandExecutionError(`Chess.com API returned an invalid response object for ${url}`);
    }
    if (resp.status === 404) throw new EmptyResultError(`Chess.com returned 404 for ${url}`);
    if (!resp.ok) throw new CommandExecutionError(`Chess.com API returned HTTP ${resp.status} for ${url}`);
    let payload;
    try {
        payload = await resp.json();
    } catch (error) {
        throw new CommandExecutionError(`Chess.com API returned malformed JSON for ${url}: ${error?.message || error}`);
    }
    if (!isPlainObject(payload)) {
        throw new CommandExecutionError(`Chess.com API returned an unexpected payload shape for ${url}`);
    }
    return payload;
}

/** Pull rating + record fields out of a stats sub-object (`chess_rapid` etc). */
export function summarizeStats(stats, kind) {
    const k = stats?.[kind];
    if (!k) return null;
    if (!isPlainObject(k)) {
        throw new CommandExecutionError(`Chess.com stats payload for ${kind} is not an object`);
    }
    if (!isOptionalPlainObject(k.last)) {
        throw new CommandExecutionError(`Chess.com stats payload for ${kind}.last is not an object`);
    }
    if (!isOptionalPlainObject(k.best)) {
        throw new CommandExecutionError(`Chess.com stats payload for ${kind}.best is not an object`);
    }
    if (!isOptionalPlainObject(k.record)) {
        throw new CommandExecutionError(`Chess.com stats payload for ${kind}.record is not an object`);
    }
    const record = isPlainObject(k.record) ? k.record : {};
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
 * Pull "Reti Opening: Nimzo-Larsen Variation" out of the Chess.com eco URL
 * (`https://www.chess.com/openings/Reti-Opening-Nimzo-Larsen-Variation-2...g6-...`).
 * Returns '' for short-code eco values (`A01`) where no name is encoded.
 */
export function openingName(eco) {
    if (typeof eco !== 'string' || !eco.startsWith('http')) return '';
    const tail = eco.replace(/\/+$/, '').split('/').pop() || '';
    if (!tail) return '';
    const namePart = tail.match(/^([^.]+?)(?:-\d|\.\.\.|$)/);
    const cleaned = (namePart ? namePart[1] : tail).replace(/-/g, ' ').trim();
    return cleaned;
}

/**
 * Map a Chess.com game record (from the monthly archive) to a flat row.
 * The viewer perspective controls win/loss orientation.
 */
export function mapGameRow(game, viewerUsername) {
    if (!isPlainObject(game)) {
        throw new CommandExecutionError('Chess.com game archive entry is not an object');
    }
    if (typeof game.url !== 'string' || !/^https:\/\/www\.chess\.com\/game\/(?:live|daily)\/\d+(?:$|[/?#])/i.test(game.url)) {
        throw new CommandExecutionError('Chess.com game archive entry is missing a stable game URL');
    }
    const white = game?.white || {};
    const black = game?.black || {};
    if (!isPlainObject(white) || !isPlainObject(black)) {
        throw new CommandExecutionError('Chess.com game archive entry has malformed player objects');
    }
    if (typeof white.username !== 'string' || !white.username.trim() || typeof black.username !== 'string' || !black.username.trim()) {
        throw new CommandExecutionError('Chess.com game archive entry is missing stable player identities');
    }
    const viewerLower = String(viewerUsername || '').toLowerCase();
    const viewerIsWhite = String(white.username || '').toLowerCase() === viewerLower;
    const viewerIsBlack = String(black.username || '').toLowerCase() === viewerLower;
    if (!viewerIsWhite && !viewerIsBlack) {
        throw new CommandExecutionError('Chess.com game archive entry does not include the requested player');
    }
    const me = viewerIsWhite ? white : black;
    const opp = viewerIsWhite ? black : white;
    const eco = game?.eco || '';
    return {
        date: formatDate(game?.end_time),
        time_class: game?.time_class || '',
        rated: game?.rated === true,
        my_color: viewerIsWhite ? 'white' : 'black',
        my_rating: me?.rating ?? '',
        my_result: me?.result || '',
        opponent: opp?.username || '',
        opponent_rating: opp?.rating ?? '',
        accuracy_white: typeof game?.accuracies?.white === 'number' ? game.accuracies.white : '',
        accuracy_black: typeof game?.accuracies?.black === 'number' ? game.accuracies.black : '',
        eco,
        opening_name: openingName(eco),
        url: game?.url || '',
    };
}

export const __test__ = {
    validateUsername,
    parseGameUrl,
    isPlainObject,
    isOptionalPlainObject,
    chessApi,
    summarizeStats,
    formatDate,
    mapGameRow,
    openingName,
};
