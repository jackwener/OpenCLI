import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './game.js';

const { summarizeGame } = await import('./game.js').then((m) => m.__test__);

afterEach(() => {
    vi.unstubAllGlobals();
});

function mockFetch(payload, status = 200) {
    return vi.fn().mockResolvedValue({
        ok: status === 200,
        status,
        json: () => Promise.resolve(payload),
    });
}

describe('chess game command', () => {
    it('summarizeGame maps the callback payload to the canonical row shape', () => {
        const row = summarizeGame({
            kind: 'live',
            id: '999',
            payload: {
                game: {
                    pgnHeaders: {
                        Date: '2026.05.17',
                        White: 'Hikaru',
                        Black: 'tactic',
                        Result: '1-0',
                        ECO: 'A01',
                        WhiteElo: 3454,
                        BlackElo: 2869,
                        TimeControl: '180',
                        Termination: 'Hikaru won by resignation',
                    },
                    colorOfWinner: 'white',
                    isRated: true,
                    plyCount: 111,
                    endTime: 1747584400,
                },
                players: {
                    top: { username: 'tactic', color: 'black', rating: 2869 },
                    bottom: { username: 'Hikaru', color: 'white', rating: 3454 },
                },
            },
        });
        expect(row).toMatchObject({
            kind: 'live',
            game_id: '999',
            date: '2026-05-17',
            white: 'Hikaru',
            white_rating: 3454,
            black: 'tactic',
            black_rating: 2869,
            result: '1-0',
            winner_color: 'white',
            termination: 'Hikaru won by resignation',
            eco: 'A01',
            time_control: '180',
            rated: true,
            ply_count: 111,
            url: 'https://www.chess.com/game/live/999',
        });
    });

    it('summarizeGame falls back to pgnHeaders when players are missing', () => {
        const row = summarizeGame({
            kind: 'daily',
            id: '1',
            payload: {
                game: {
                    pgnHeaders: { White: 'A', Black: 'B', Result: '1/2-1/2', WhiteElo: 1200, BlackElo: 1300 },
                    colorOfWinner: '',
                    isRated: false,
                    daysPerTurn: 3,
                },
                players: {},
            },
        });
        expect(row.white).toBe('A');
        expect(row.black_rating).toBe(1300);
        expect(row.time_control).toBe('3d/turn');
        expect(row.rated).toBe(false);
    });

    it('summarizeGame throws CommandExecutionError on missing game payload', () => {
        expect(() => summarizeGame({ kind: 'live', id: '1', payload: {} })).toThrow(CommandExecutionError);
        expect(() => summarizeGame({ kind: 'live', id: '1', payload: null })).toThrow(CommandExecutionError);
    });

    it('summarizeGame throws CommandExecutionError on malformed nested payloads', () => {
        expect(() => summarizeGame({
            kind: 'live',
            id: '1',
            payload: { game: { pgnHeaders: [] } },
        })).toThrow(CommandExecutionError);
        expect(() => summarizeGame({
            kind: 'live',
            id: '1',
            payload: { game: { pgnHeaders: { White: 'A', Black: 'B' } }, players: [] },
        })).toThrow(CommandExecutionError);
    });

    it('summarizeGame requires stable players and result evidence', () => {
        expect(() => summarizeGame({
            kind: 'live',
            id: '1',
            payload: { game: { pgnHeaders: { White: 'A', Black: 'B' } }, players: {} },
        })).toThrow(CommandExecutionError);
        expect(() => summarizeGame({
            kind: 'live',
            id: '1',
            payload: { game: { pgnHeaders: { White: 'A', Result: '1-0' } }, players: {} },
        })).toThrow(CommandExecutionError);
    });

    it('command fetches the callback URL and returns a single row', async () => {
        const fetchMock = mockFetch({
            game: { pgnHeaders: { White: 'A', Black: 'B', Result: '1-0', WhiteElo: 100, BlackElo: 90 } },
            players: {},
        });
        vi.stubGlobal('fetch', fetchMock);
        const cmd = getRegistry().get('chess/game');
        const rows = await cmd.func({ 'game-url': 'https://www.chess.com/game/live/42' });
        expect(rows).toHaveLength(1);
        expect(rows[0].url).toBe('https://www.chess.com/game/live/42');
        expect(fetchMock).toHaveBeenCalledWith(
            'https://www.chess.com/callback/live/game/42',
            expect.objectContaining({ headers: expect.any(Object) }),
        );
    });

    it('command surfaces 404 as EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
        const cmd = getRegistry().get('chess/game');
        await expect(cmd.func({ 'game-url': 'https://www.chess.com/game/live/1' }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });

    it('command surfaces non-2xx as CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        const cmd = getRegistry().get('chess/game');
        await expect(cmd.func({ 'game-url': 'https://www.chess.com/game/live/1' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('command maps fetch and JSON failures to CommandExecutionError', async () => {
        const cmd = getRegistry().get('chess/game');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
        await expect(cmd.func({ 'game-url': 'https://www.chess.com/game/live/1' }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.reject(new SyntaxError('bad json')),
        }));
        await expect(cmd.func({ 'game-url': 'https://www.chess.com/game/live/1' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('command maps wrong-shape callback JSON to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', mockFetch([]));
        const cmd = getRegistry().get('chess/game');
        await expect(cmd.func({ 'game-url': 'https://www.chess.com/game/live/1' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects invalid URL with ArgumentError before any fetch', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const cmd = getRegistry().get('chess/game');
        await expect(cmd.func({ 'game-url': 'not-a-url' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
