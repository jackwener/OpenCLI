import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { __test__ } from './utils.js';

const { validateUsername, summarizeStats, formatDate, mapGameRow, openingName } = __test__;

describe('chess utils', () => {
    it('validateUsername lowercases and accepts 3-25 char usernames', () => {
        expect(validateUsername('Hikaru')).toBe('hikaru');
        expect(validateUsername('MagnusCarlsen')).toBe('magnuscarlsen');
        expect(validateUsername('a-b_c')).toBe('a-b_c');
    });

    it('validateUsername rejects empty / too-short / invalid chars', () => {
        expect(() => validateUsername('')).toThrow(ArgumentError);
        expect(() => validateUsername('ab')).toThrow(ArgumentError);
        expect(() => validateUsername('user name')).toThrow(ArgumentError);
        expect(() => validateUsername('a'.repeat(30))).toThrow(ArgumentError);
    });

    it('summarizeStats projects rating + record fields', () => {
        const stats = {
            chess_rapid: {
                last: { rating: 1600 },
                best: { rating: 1800 },
                record: { win: 100, loss: 50, draw: 10 },
            },
        };
        expect(summarizeStats(stats, 'chess_rapid')).toEqual({
            kind: 'rapid',
            rating_current: 1600,
            rating_best: 1800,
            wins: 100,
            losses: 50,
            draws: 10,
        });
    });

    it('summarizeStats returns null for missing kind', () => {
        expect(summarizeStats({}, 'chess_rapid')).toBeNull();
        expect(summarizeStats({ chess_blitz: {} }, 'chess_rapid')).toBeNull();
    });

    it('summarizeStats coerces missing numeric fields to empty string', () => {
        const row = summarizeStats({ chess_daily: { last: {}, record: {} } }, 'chess_daily');
        expect(row).toEqual({
            kind: 'daily',
            rating_current: '',
            rating_best: '',
            wins: '',
            losses: '',
            draws: '',
        });
    });

    it('formatDate converts epoch seconds to YYYY-MM-DD', () => {
        expect(formatDate(1777737679)).toBe('2026-05-02');
        expect(formatDate(0)).toBe('');
        expect(formatDate(null)).toBe('');
        expect(formatDate('not-a-number')).toBe('');
    });

    it('mapGameRow returns rows from the viewer perspective when viewer is white', () => {
        const game = {
            url: 'https://www.chess.com/game/live/123',
            end_time: 1777737679,
            time_class: 'blitz',
            rated: true,
            eco: 'C50',
            accuracies: { white: 87.73, black: 80.23 },
            white: { username: 'Hikaru', rating: 3286, result: 'win' },
            black: { username: 'Magnus', rating: 2900, result: 'resigned' },
        };
        expect(mapGameRow(game, 'Hikaru')).toEqual({
            date: '2026-05-02',
            time_class: 'blitz',
            rated: true,
            my_color: 'white',
            my_rating: 3286,
            my_result: 'win',
            opponent: 'Magnus',
            opponent_rating: 2900,
            accuracy_white: 87.73,
            accuracy_black: 80.23,
            eco: 'C50',
            opening_name: '',
            url: 'https://www.chess.com/game/live/123',
        });
    });

    it('mapGameRow leaves accuracy fields empty when chess.com did not compute them', () => {
        const game = {
            white: { username: 'A', rating: 1, result: 'win' },
            black: { username: 'B', rating: 1, result: 'resigned' },
        };
        const row = mapGameRow(game, 'A');
        expect(row.accuracy_white).toBe('');
        expect(row.accuracy_black).toBe('');
    });

    it('mapGameRow parses opening_name from the chess.com eco URL', () => {
        const game = {
            eco: 'https://www.chess.com/openings/Reti-Opening-Nimzo-Larsen-Variation-2...g6-3.Bb2-Bg7-4.d4',
            white: { username: 'A', rating: 1, result: 'win' },
            black: { username: 'B', rating: 1, result: 'resigned' },
        };
        const row = mapGameRow(game, 'A');
        expect(row.opening_name).toBe('Reti Opening Nimzo Larsen Variation');
    });

    it('openingName helper returns clean human-readable name from URL form', () => {
        expect(openingName('https://www.chess.com/openings/Sicilian-Defense')).toBe('Sicilian Defense');
        expect(openingName('https://www.chess.com/openings/Kings-Indian-Defense-Semi-Classical-Variation...7.O-O'))
            .toBe('Kings Indian Defense Semi Classical Variation');
        expect(openingName('https://www.chess.com/openings/French-Defense-Advance-Variation-3...c5-4.c3'))
            .toBe('French Defense Advance Variation');
    });

    it('openingName returns empty for short-code eco or missing input', () => {
        expect(openingName('A01')).toBe('');
        expect(openingName('')).toBe('');
        expect(openingName(undefined)).toBe('');
        expect(openingName(null)).toBe('');
    });

    it('mapGameRow flips perspective when viewer is black', () => {
        const game = {
            white: { username: 'Hikaru', rating: 3286, result: 'win' },
            black: { username: 'Magnus', rating: 2900, result: 'resigned' },
        };
        const row = mapGameRow(game, 'Magnus');
        expect(row.my_color).toBe('black');
        expect(row.my_result).toBe('resigned');
        expect(row.opponent).toBe('Hikaru');
    });

    it('mapGameRow matches viewer case-insensitively', () => {
        const game = {
            white: { username: 'Hikaru', rating: 3286, result: 'win' },
            black: { username: 'Magnus', rating: 2900, result: 'resigned' },
        };
        expect(mapGameRow(game, 'hikaru').my_color).toBe('white');
        expect(mapGameRow(game, 'MAGNUS').my_color).toBe('black');
    });

    it('mapGameRow falls back to black when viewer is neither player (defensive)', () => {
        const game = {
            white: { username: 'A', rating: 1000, result: 'win' },
            black: { username: 'B', rating: 1100, result: 'resigned' },
        };
        const row = mapGameRow(game, 'C');
        expect(row.my_color).toBe('black');
        expect(row.opponent).toBe('A');
    });

    it('mapGameRow handles missing optional fields without throwing', () => {
        const row = mapGameRow({}, 'x');
        expect(row.date).toBe('');
        expect(row.url).toBe('');
        expect(row.eco).toBe('');
    });
});
