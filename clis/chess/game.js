/**
 * Chess.com single-game detail by URL, via the internal callback
 * endpoint `/callback/{live|daily}/game/{id}`. Returns the canonical
 * PGN headers + move data plus per-player metadata.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { UA, formatDate, isPlainObject, parseGameUrl } from './utils.js';

const CALLBACK_BASE = 'https://www.chess.com/callback';

function stringOrEmpty(value) {
    return typeof value === 'string' ? value : '';
}

function scalarOrEmpty(value) {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : '';
}

export function summarizeGame({ kind, id, payload }) {
    if (!isPlainObject(payload) || !isPlainObject(payload.game)) {
        throw new CommandExecutionError('Chess.com callback returned no game payload');
    }
    const g = payload.game;
    if (g.pgnHeaders !== undefined && !isPlainObject(g.pgnHeaders)) {
        throw new CommandExecutionError('Chess.com callback returned malformed PGN headers');
    }
    if (payload.players !== undefined && !isPlainObject(payload.players)) {
        throw new CommandExecutionError('Chess.com callback returned malformed player metadata');
    }
    const players = payload.players || {};
    const byColor = {};
    for (const slot of ['top', 'bottom']) {
        const p = players[slot];
        if (p !== undefined && !isPlainObject(p)) {
            throw new CommandExecutionError('Chess.com callback returned malformed player metadata');
        }
        if (p?.color) byColor[p.color] = p;
    }
    const white = byColor.white || {};
    const black = byColor.black || {};
    const headers = g.pgnHeaders || {};
    const whiteName = stringOrEmpty(white.username) || stringOrEmpty(headers.White);
    const blackName = stringOrEmpty(black.username) || stringOrEmpty(headers.Black);
    const result = stringOrEmpty(headers.Result);
    if (!whiteName || !blackName || !result) {
        throw new CommandExecutionError('Chess.com callback payload is missing stable game summary fields');
    }
    const headerDate = stringOrEmpty(headers.Date);
    return {
        kind,
        game_id: id,
        date: headerDate ? headerDate.replace(/\./g, '-') : formatDate(g.endTime),
        white: whiteName,
        white_rating: scalarOrEmpty(white.rating) || scalarOrEmpty(headers.WhiteElo),
        black: blackName,
        black_rating: scalarOrEmpty(black.rating) || scalarOrEmpty(headers.BlackElo),
        result,
        winner_color: stringOrEmpty(g.colorOfWinner),
        termination: stringOrEmpty(headers.Termination) || stringOrEmpty(g.resultMessage),
        eco: stringOrEmpty(headers.ECO),
        time_control: stringOrEmpty(headers.TimeControl) || (typeof g.daysPerTurn === 'number' ? `${g.daysPerTurn}d/turn` : ''),
        rated: g.isRated === true,
        ply_count: g.plyCount ?? '',
        url: `https://www.chess.com/game/${kind}/${id}`,
    };
}

cli({
    site: 'chess',
    name: 'game',
    access: 'read',
    description: 'Chess.com single-game detail (white, black, result, ECO, time control) by full game URL',
    domain: 'www.chess.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'game-url', type: 'string', required: true, positional: true, help: 'Full game URL, e.g. https://www.chess.com/game/live/168842570216' },
    ],
    columns: [
        'kind', 'game_id', 'date',
        'white', 'white_rating', 'black', 'black_rating',
        'result', 'winner_color', 'termination',
        'eco', 'time_control', 'rated', 'ply_count', 'url',
    ],
    func: async (kwargs) => {
        const { kind, id } = parseGameUrl(kwargs['game-url']);
        const url = `${CALLBACK_BASE}/${kind}/game/${id}`;
        let resp;
        try {
            resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
        } catch (error) {
            throw new CommandExecutionError(`Failed to fetch Chess.com callback ${url}: ${error?.message || error}`);
        }
        if (!resp || typeof resp !== 'object') {
            throw new CommandExecutionError(`Chess.com callback returned an invalid response object for ${url}`);
        }
        if (resp.status === 404) {
            throw new EmptyResultError(`Chess.com has no ${kind} game with id ${id}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`Chess.com callback returned HTTP ${resp.status} for ${url}`);
        }
        let payload;
        try {
            payload = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`Chess.com callback returned malformed JSON for ${url}: ${error?.message || error}`);
        }
        return [summarizeGame({ kind, id, payload })];
    },
});

export const __test__ = { parseGameUrl, summarizeGame };
