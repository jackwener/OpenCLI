import { describe, expect, it } from 'vitest';
import { isoDate, metersToKm, normalizeActivityId, secondsToHms } from './utils.js';
describe('garmin utils', () => {
    it('formats meters as kilometres', () => {
        expect(metersToKm(59396.46875)).toBe('59.40');
        expect(metersToKm(1000)).toBe('1.00');
        expect(metersToKm(null)).toBe('');
        expect(metersToKm(undefined)).toBe('');
    });
    it('formats seconds as H:MM:SS / M:SS', () => {
        expect(secondsToHms(8672)).toBe('2:24:32');
        expect(secondsToHms(125)).toBe('2:05');
        expect(secondsToHms(0)).toBe('0:00');
        expect(secondsToHms(null)).toBe('');
    });
    it('validates dates and falls back to today', () => {
        expect(isoDate('2026-06-21')).toBe('2026-06-21');
        expect(isoDate('garbage')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(isoDate(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    it('normalizes activity ids from ids, paths and urls', () => {
        expect(normalizeActivityId('23329324278')).toBe('23329324278');
        expect(normalizeActivityId('/modern/activity/23329324278')).toBe('23329324278');
        expect(normalizeActivityId('https://connect.garmin.com/modern/activity/23329324278')).toBe('23329324278');
        expect(normalizeActivityId(null)).toBe('');
    });
});
