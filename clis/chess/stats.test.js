import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './stats.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

function mockFetch(body) {
    return vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
    });
}

describe('chess stats command', () => {
    it('rejects empty username via validateUsername', async () => {
        const cmd = getRegistry().get('chess/stats');
        await expect(cmd.func({ username: '' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects invalid username characters', async () => {
        const cmd = getRegistry().get('chess/stats');
        await expect(cmd.func({ username: 'user name' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('returns one row per known game kind populated in the stats response', async () => {
        const fetchMock = mockFetch({
            chess_rapid: { last: { rating: 1700 }, best: { rating: 1800 }, record: { win: 50, loss: 20, draw: 5 } },
            chess_blitz: { last: { rating: 1500 }, best: { rating: 1600 }, record: { win: 100, loss: 80, draw: 10 } },
        });
        vi.stubGlobal('fetch', fetchMock);
        const cmd = getRegistry().get('chess/stats');
        const rows = await cmd.func({ username: 'someuser' });
        expect(rows).toHaveLength(2);
        expect(rows[0].kind).toBe('rapid');
        expect(rows[1].kind).toBe('blitz');
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.chess.com/pub/player/someuser/stats',
            expect.objectContaining({ headers: expect.any(Object) }),
        );
    });

    it('lowercases username in the URL', async () => {
        const fetchMock = mockFetch({ chess_rapid: { last: { rating: 1 }, best: {}, record: {} } });
        vi.stubGlobal('fetch', fetchMock);
        const cmd = getRegistry().get('chess/stats');
        await cmd.func({ username: 'MixedCase' });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.chess.com/pub/player/mixedcase/stats',
            expect.any(Object),
        );
    });

    it('throws EmptyResultError when the stats response has no known kinds', async () => {
        vi.stubGlobal('fetch', mockFetch({}));
        const cmd = getRegistry().get('chess/stats');
        await expect(cmd.func({ username: 'someuser' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('throws CommandExecutionError when a populated stats kind is malformed', async () => {
        vi.stubGlobal('fetch', mockFetch({ chess_rapid: 'bad' }));
        const cmd = getRegistry().get('chess/stats');
        await expect(cmd.func({ username: 'someuser' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws EmptyResultError on HTTP 404', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
        const cmd = getRegistry().get('chess/stats');
        await expect(cmd.func({ username: 'someuser' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('registers with the expected columns', () => {
        const cmd = getRegistry().get('chess/stats');
        expect(cmd?.columns).toEqual(['kind', 'rating_current', 'rating_best', 'wins', 'losses', 'draws']);
    });
});
