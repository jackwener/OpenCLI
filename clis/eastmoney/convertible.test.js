import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ } from './convertible.js';

const { SORTS, extractConvertibleDiff, mapConvertibleRows, parseConvertibleLimit } = __test__;

function row(overrides = {}) {
    return {
        f12: '123001', f14: '春风转债', f2: 166.559, f3: 0.5,
        f232: '605090', f234: '春风动力', f229: 100, f230: 0.1,
        f235: 241.7, f236: 68.9, f237: 56.34, f238: 9.5, f239: 169.19, f243: 20220610,
        ...overrides,
    };
}

describe('eastmoney convertible field mapping (#2109)', () => {
    it('relabels f238/f239 to their true semantics and drops the mislabeled ytm/remainingYears', () => {
        // 春风转债 fingerprint: convPrice(f235)=241.7, f239=169.19 ≈ 241.7 × 0.7 (putback trigger).
        const diff = [row()];
        const rows = mapConvertibleRows(diff, 20);
        expect(rows[0]).toEqual({
            rank: 1,
            bondCode: '123001', bondName: '春风转债', bondPrice: 166.559, bondChangePct: 0.5,
            stockCode: '605090', stockName: '春风动力', stockPrice: 100, stockChangePct: 0.1,
            convPrice: 241.7, convValue: 68.9, convPremiumPct: 56.34,
            pureBondPremiumPct: 9.5, putTriggerPrice: 169.19, listDate: '20220610',
        });
        // regression guard: the known-wrong columns must be gone
        expect(rows[0]).not.toHaveProperty('ytm');
        expect(rows[0]).not.toHaveProperty('remainingYears');
        // and the fingerprint that proved the mislabel: putTriggerPrice ≈ convPrice × 0.7
        expect(rows[0].putTriggerPrice).toBeCloseTo(rows[0].convPrice * 0.7, 1);
    });

    it('respects the limit and assigns 1-based rank', () => {
        const diff = Array.from({ length: 5 }, (_, i) => row({ f12: 'c' + i }));
        const rows = mapConvertibleRows(diff, 2);
        expect(rows).toHaveLength(2);
        expect(rows.map(r => r.rank)).toEqual([1, 2]);
    });

    it('classifies response shape drift separately from true empty results', () => {
        expect(extractConvertibleDiff({ data: { diff: [row()] } })).toHaveLength(1);
        expect(() => extractConvertibleDiff({ data: { diff: [] } })).toThrow(EmptyResultError);
        expect(() => extractConvertibleDiff({ data: { diff: null } })).toThrow(CommandExecutionError);
        expect(() => mapConvertibleRows(null, 20)).toThrow(CommandExecutionError);
    });

    it('fails closed on malformed scalar and numeric fields', () => {
        expect(() => mapConvertibleRows([row({ f12: null })], 20)).toThrow(CommandExecutionError);
        expect(() => mapConvertibleRows([row({ f12: '' })], 20)).toThrow(CommandExecutionError);
        expect(() => mapConvertibleRows([row({ f12: 123001 })], 20)).toThrow(CommandExecutionError);
        expect(() => mapConvertibleRows([row({ f239: '169.19' })], 20)).toThrow(CommandExecutionError);
        expect(() => mapConvertibleRows([row({ f239: '-' })], 20)).not.toThrow();
    });

    it('parses limit strictly within 1..100', () => {
        expect(parseConvertibleLimit(undefined)).toBe(20);
        expect(parseConvertibleLimit(2)).toBe(2);
        expect(parseConvertibleLimit('02')).toBe(2);
        for (const bad of [0, 101, 1.5, '1e2', 'abc', '-1']) {
            expect(() => parseConvertibleLimit(bad)).toThrow(ArgumentError);
        }
    });

    it('drops the semantically-wrong ytm sort and exposes put-trigger instead', () => {
        expect(SORTS).not.toHaveProperty('ytm');
        expect(SORTS['put-trigger']).toEqual({ fid: 'f239', order: 'desc' });
    });
});
