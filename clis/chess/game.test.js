import { describe, expect, it } from 'vitest';

import { CommandExecutionError } from '@jackwener/opencli/errors';

const { summarizeGame } = await import('./game.js').then((m) => m.__test__);

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

});
