import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './games.js';

const { parseLimit } = await import('./games.js').then((m) => m.__test__);

afterEach(() => {
    vi.unstubAllGlobals();
});

function fetchFor(map) {
    return vi.fn().mockImplementation((url) => {
        if (map.has(url)) {
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(map.get(url)) });
        }
        return Promise.resolve({ ok: false, status: 404 });
    });
}

function game(white, whiteRating, black, blackRating, endTime, extra = {}) {
    return {
        url: `https://www.chess.com/game/live/${endTime}`,
        end_time: endTime,
        time_class: 'blitz',
        rated: true,
        eco: 'C50',
        white: { username: white, rating: whiteRating, result: 'win' },
        black: { username: black, rating: blackRating, result: 'resigned' },
        ...extra,
    };
}

describe('chess games command', () => {
    it('parseLimit accepts 1-100, rejects everything else', () => {
        expect(parseLimit(undefined)).toBe(10);
        expect(parseLimit(1)).toBe(1);
        expect(parseLimit(100)).toBe(100);
        expect(() => parseLimit(0)).toThrow(ArgumentError);
        expect(() => parseLimit(101)).toThrow(ArgumentError);
        expect(() => parseLimit(1.5)).toThrow(ArgumentError);
        expect(() => parseLimit('abc')).toThrow(ArgumentError);
    });

    it('returns recent games newest-first sliced to --limit', async () => {
        const map = new Map([
            ['https://api.chess.com/pub/player/hikaru/games/archives', {
                archives: ['https://api.chess.com/pub/player/hikaru/games/2026/04', 'https://api.chess.com/pub/player/hikaru/games/2026/05'],
            }],
            ['https://api.chess.com/pub/player/hikaru/games/2026/05', {
                games: [
                    game('Hikaru', 3286, 'A', 2900, 1777737000),
                    game('Hikaru', 3286, 'B', 2950, 1777737500),
                    game('Hikaru', 3286, 'C', 3000, 1777737900),
                ],
            }],
        ]);
        vi.stubGlobal('fetch', fetchFor(map));
        const cmd = getRegistry().get('chess/games');
        const rows = await cmd.func({ username: 'Hikaru', limit: 2 });
        expect(rows).toHaveLength(2);
        // archive is reversed (newest month first), games within are reversed
        // so the first row corresponds to the LAST game in the JSON array.
        expect(rows[0].opponent).toBe('C');
        expect(rows[1].opponent).toBe('B');
    });

    it('walks multiple months until --limit is filled', async () => {
        const map = new Map([
            ['https://api.chess.com/pub/player/hikaru/games/archives', {
                archives: ['https://api.chess.com/pub/player/hikaru/games/2026/03', 'https://api.chess.com/pub/player/hikaru/games/2026/04'],
            }],
            ['https://api.chess.com/pub/player/hikaru/games/2026/04', {
                games: [game('Hikaru', 3286, 'A', 2900, 1777737000)],
            }],
            ['https://api.chess.com/pub/player/hikaru/games/2026/03', {
                games: [game('Hikaru', 3286, 'B', 2950, 1774000000)],
            }],
        ]);
        vi.stubGlobal('fetch', fetchFor(map));
        const cmd = getRegistry().get('chess/games');
        const rows = await cmd.func({ username: 'Hikaru', limit: 2 });
        expect(rows.map((r) => r.opponent)).toEqual(['A', 'B']);
    });

    it('throws EmptyResultError when archives list is empty', async () => {
        const map = new Map([
            ['https://api.chess.com/pub/player/someuser/games/archives', { archives: [] }],
        ]);
        vi.stubGlobal('fetch', fetchFor(map));
        const cmd = getRegistry().get('chess/games');
        await expect(cmd.func({ username: 'someuser', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('throws CommandExecutionError when archives payload is wrong-shape', async () => {
        const map = new Map([
            ['https://api.chess.com/pub/player/someuser/games/archives', { archives: {} }],
        ]);
        vi.stubGlobal('fetch', fetchFor(map));
        const cmd = getRegistry().get('chess/games');
        await expect(cmd.func({ username: 'someuser', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError when monthly archive games payload is wrong-shape', async () => {
        const map = new Map([
            ['https://api.chess.com/pub/player/hikaru/games/archives', {
                archives: ['https://api.chess.com/pub/player/hikaru/games/2026/05'],
            }],
            ['https://api.chess.com/pub/player/hikaru/games/2026/05', { games: null }],
        ]);
        vi.stubGlobal('fetch', fetchFor(map));
        const cmd = getRegistry().get('chess/games');
        await expect(cmd.func({ username: 'Hikaru', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError when a game row lacks stable identity', async () => {
        const map = new Map([
            ['https://api.chess.com/pub/player/hikaru/games/archives', {
                archives: ['https://api.chess.com/pub/player/hikaru/games/2026/05'],
            }],
            ['https://api.chess.com/pub/player/hikaru/games/2026/05', {
                games: [{
                    end_time: 1777737000,
                    white: { username: 'Hikaru', rating: 3286, result: 'win' },
                    black: { username: 'A', rating: 2900, result: 'resigned' },
                }],
            }],
        ]);
        vi.stubGlobal('fetch', fetchFor(map));
        const cmd = getRegistry().get('chess/games');
        await expect(cmd.func({ username: 'Hikaru', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError when a game row does not include the requested player', async () => {
        const map = new Map([
            ['https://api.chess.com/pub/player/hikaru/games/archives', {
                archives: ['https://api.chess.com/pub/player/hikaru/games/2026/05'],
            }],
            ['https://api.chess.com/pub/player/hikaru/games/2026/05', {
                games: [game('A', 2900, 'B', 2800, 1777737000)],
            }],
        ]);
        vi.stubGlobal('fetch', fetchFor(map));
        const cmd = getRegistry().get('chess/games');
        await expect(cmd.func({ username: 'Hikaru', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws ArgumentError on invalid username before any fetch', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const cmd = getRegistry().get('chess/games');
        await expect(cmd.func({ username: 'a b', limit: 5 })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('registers with the expected columns', () => {
        const cmd = getRegistry().get('chess/games');
        expect(cmd?.columns).toEqual([
            'date', 'time_class', 'rated', 'my_color', 'my_rating', 'my_result',
            'opponent', 'opponent_rating', 'accuracy_white', 'accuracy_black',
            'eco', 'opening_name', 'url',
        ]);
    });
});
