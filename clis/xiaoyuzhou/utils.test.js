import { describe, it, expect } from 'vitest';
import { formatDuration, formatDate } from './utils.js';
describe('formatDuration', () => {
    it('formats typical duration', () => {
        expect(formatDuration(3890)).toBe('64:50');
    });
    it('formats zero seconds', () => {
        expect(formatDuration(0)).toBe('0:00');
    });
    it('pads single-digit seconds', () => {
        expect(formatDuration(62)).toBe('1:02');
    });
    it('handles exact minutes', () => {
        expect(formatDuration(120)).toBe('2:00');
    });
    it('rounds fractional seconds', () => {
        expect(formatDuration(65.7)).toBe('1:06');
    });
    it('returns dash for NaN', () => {
        expect(formatDuration(NaN)).toBe('-');
    });
    it('returns dash for negative', () => {
        expect(formatDuration(-1)).toBe('-');
    });
    it('returns dash for Infinity', () => {
        expect(formatDuration(Infinity)).toBe('-');
    });
});
describe('formatDate', () => {
    it('slices ISO string to date', () => {
        expect(formatDate('2026-03-15T12:00:00Z')).toBe('2026-03-15');
    });
    it('returns dash for empty string', () => {
        expect(formatDate('')).toBe('-');
    });
    it('returns dash for undefined', () => {
        expect(formatDate(undefined)).toBe('-');
    });
});
