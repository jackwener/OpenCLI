import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
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

});
