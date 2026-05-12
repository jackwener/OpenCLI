import { describe, expect, it } from 'vitest';
import { formatChinaDate } from './utils.js';

describe('formatChinaDate', () => {
    it('returns the Asia/Shanghai date for a UTC ms at China midnight', () => {
        expect(formatChinaDate(Date.UTC(2026, 4, 7, 16, 0, 0))).toBe('2026-05-08');
    });
    it('returns the same China date for a moment late in the day', () => {
        expect(formatChinaDate(Date.UTC(2026, 4, 8, 14, 0, 0))).toBe('2026-05-08');
    });
    it('crosses the China day boundary at 16:00 UTC', () => {
        expect(formatChinaDate(Date.UTC(2026, 0, 1, 15, 59, 59))).toBe('2026-01-01');
        expect(formatChinaDate(Date.UTC(2026, 0, 1, 16, 0, 0))).toBe('2026-01-02');
    });
    it('returns null for nullish input', () => {
        expect(formatChinaDate(null)).toBeNull();
        expect(formatChinaDate(undefined)).toBeNull();
    });
});
