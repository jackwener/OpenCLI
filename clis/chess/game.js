/**
 * Chess.com single-game detail by URL, via the internal callback
 * endpoint `/callback/{live|daily}/game/{id}`. Returns the canonical
 * PGN headers + move data plus per-player metadata.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { UA, formatDate } from './utils.js';

const CALLBACK_BASE = 'https://www.chess.com/callback';
const URL_RE = /^https:\/\/www\.chess\.com\/game\/(live|daily)\/(\d+)/i;

export function parseGameUrl(value) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError('<game-url> is required');
    const m = s.match(URL_RE);
    if (!m) {
        throw new ArgumentError(
            `Invalid Chess.com game URL: "${value}"`,
            'Expected https://www.chess.com/game/live/<id> or https://www.chess.com/game/daily/<id>.',
        );
    }
    return { kind: m[1].toLowerCase(), id: m[2] };
}

export function summarizeGame({ kind, id, payload }) {
    if (!payload?.game) {
        throw new CommandExecutionError('Chess.com callback returned no game payload');
    }
    const g = payload.game;
    const players = payload.players || {};
    const byColor = {};
    for (const slot of ['top', 'bottom']) {
        const p = players[slot];
        if (p?.color) byColor[p.color] = p;
    }
    const white = byColor.white || {};
    const black = byColor.black || {};
    const headers = g.pgnHeaders || {};
    return {
        kind,
        game_id: id,
        date: headers.Date ? headers.Date.replace(/\./g, '-') : formatDate(g.endTime),
        white: white.username || headers.White || '',
        white_rating: white.rating || headers.WhiteElo || '',
        black: black.username || headers.Black || '',
        black_rating: black.rating || headers.BlackElo || '',
        result: headers.Result || '',
        winner_color: g.colorOfWinner || '',
        termination: headers.Termination || g.resultMessage || '',
        eco: headers.ECO || '',
        time_control: headers.TimeControl || (g.daysPerTurn ? `${g.daysPerTurn}d/turn` : ''),
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
        const resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
        if (resp.status === 404) {
            throw new EmptyResultError(`Chess.com has no ${kind} game with id ${id}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`Chess.com callback returned HTTP ${resp.status} for ${url}`);
        }
        const payload = await resp.json();
        return [summarizeGame({ kind, id, payload })];
    },
});

export const __test__ = { parseGameUrl, summarizeGame };
