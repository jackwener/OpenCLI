import { describe, expect, it } from 'vitest';
import { __test__ } from './convertible.js';

const { SORTS, mapConvertibleRows } = __test__;

describe('eastmoney convertible field mapping (#2109)', () => {
    it('relabels f238/f239 to their true semantics and drops the mislabeled ytm/remainingYears', () => {
        // 春风转债 fingerprint: convPrice(f235)=241.7, f239=169.19 ≈ 241.7 × 0.7 (putback trigger).
        const diff = [{
            f12: '123001', f14: '春风转债', f2: 166.559, f3: 0.5,
            f232: '605090', f234: '春风动力', f229: 100, f230: 0.1,
            f235: 241.7, f236: 68.9, f237: 56.34, f238: 9.5, f239: 169.19, f243: 20220610,
        }];
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
        const diff = Array.from({ length: 5 }, (_, i) => ({ f12: 'c' + i, f235: 100, f239: 70 }));
        const rows = mapConvertibleRows(diff, 2);
        expect(rows).toHaveLength(2);
        expect(rows.map(r => r.rank)).toEqual([1, 2]);
    });

    it('handles empty / non-array input', () => {
        expect(mapConvertibleRows([], 20)).toEqual([]);
        expect(mapConvertibleRows(null, 20)).toEqual([]);
    });

    it('drops the semantically-wrong ytm sort and exposes put-trigger instead', () => {
        expect(SORTS).not.toHaveProperty('ytm');
        expect(SORTS['put-trigger']).toEqual({ fid: 'f239', order: 'desc' });
    });
});
