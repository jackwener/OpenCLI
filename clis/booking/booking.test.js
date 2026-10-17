import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import { __test__ } from './search.js';

const {
    normalizePositiveInt,
    normalizeNonNegativeInt,
    normalizeDate,
    normalizeCurrency,
    normalizeLang,
    hasPositiveResultCount,
    buildSearchUrl,
} = __test__;

describe('booking helpers — normalizePositiveInt (no silent clamp)', () => {
    it('returns default when value is undefined/null/empty', () => {
        expect(normalizePositiveInt(undefined, 2, 'adults', 30)).toBe(2);
        expect(normalizePositiveInt(null, 2, 'adults', 30)).toBe(2);
    });

    it('accepts integers in range', () => {
        expect(normalizePositiveInt(1, 2, 'adults', 30)).toBe(1);
        expect(normalizePositiveInt(30, 2, 'adults', 30)).toBe(30);
    });

    it('rejects zero / negative / out-of-range / non-integer (no silent clamp)', () => {
        expect(() => normalizePositiveInt(0, 2, 'adults', 30)).toThrow(ArgumentError);
        expect(() => normalizePositiveInt(-1, 2, 'adults', 30)).toThrow(ArgumentError);
        expect(() => normalizePositiveInt(31, 2, 'adults', 30)).toThrow(ArgumentError);
        expect(() => normalizePositiveInt(1.5, 2, 'adults', 30)).toThrow(ArgumentError);
        expect(() => normalizePositiveInt('abc', 2, 'adults', 30)).toThrow(ArgumentError);
    });
});

describe('booking helpers — normalizeNonNegativeInt', () => {
    it('accepts zero', () => {
        expect(normalizeNonNegativeInt(0, 0, 'children', 10)).toBe(0);
    });

    it('rejects negative / out-of-range (no silent clamp)', () => {
        expect(() => normalizeNonNegativeInt(-1, 0, 'children', 10)).toThrow(ArgumentError);
        expect(() => normalizeNonNegativeInt(11, 0, 'children', 10)).toThrow(ArgumentError);
    });
});

describe('booking helpers — normalizeDate', () => {
    it('accepts YYYY-MM-DD', () => {
        expect(normalizeDate('2026-06-15', 'checkin')).toBe('2026-06-15');
    });

    it('rejects bad format / nonsense dates with ArgumentError', () => {
        expect(() => normalizeDate('', 'checkin')).toThrow(ArgumentError);
        expect(() => normalizeDate('06/15/2026', 'checkin')).toThrow(ArgumentError);
        expect(() => normalizeDate('2026-13-40', 'checkin')).toThrow(ArgumentError);
        expect(() => normalizeDate('2026-02-31', 'checkin')).toThrow(ArgumentError);
    });
});

describe('booking helpers — normalizeCurrency', () => {
    it('passes 3-letter codes uppercased', () => {
        expect(normalizeCurrency('usd')).toBe('USD');
        expect(normalizeCurrency('JPY')).toBe('JPY');
    });

    it('returns empty for unset', () => {
        expect(normalizeCurrency(undefined)).toBe('');
        expect(normalizeCurrency('')).toBe('');
    });

    it('rejects non-3-letter codes', () => {
        expect(() => normalizeCurrency('US')).toThrow(ArgumentError);
        expect(() => normalizeCurrency('US$')).toThrow(ArgumentError);
        expect(() => normalizeCurrency('USDX')).toThrow(ArgumentError);
    });
});

describe('booking helpers — normalizeLang whitelist', () => {
    it('lowercases supported langs', () => {
        expect(normalizeLang('EN-US')).toBe('en-us');
        expect(normalizeLang('zh-cn')).toBe('zh-cn');
    });

    it('rejects unknown langs', () => {
        expect(() => normalizeLang('xx-yy')).toThrow(ArgumentError);
        expect(() => normalizeLang('en')).toThrow(ArgumentError);
    });
});

describe('booking helpers — buildSearchUrl', () => {
    it('constructs canonical search URL with required params', () => {
        const url = buildSearchUrl({
            destination: 'Tokyo',
            checkin: '2026-06-15',
            checkout: '2026-06-17',
            adults: 2,
            rooms: 1,
            children: 0,
            offset: 0,
            currency: 'USD',
            lang: 'en-us',
        });
        expect(url).toContain('https://www.booking.com/searchresults.en-us.html');
        expect(url).toContain('ss=Tokyo');
        expect(url).toContain('checkin=2026-06-15');
        expect(url).toContain('checkout=2026-06-17');
        expect(url).toContain('group_adults=2');
        expect(url).toContain('no_rooms=1');
        expect(url).toContain('group_children=0');
        expect(url).toContain('selected_currency=USD');
        expect(url).not.toContain('offset=');
    });

    it('omits lang file segment when lang is empty', () => {
        const url = buildSearchUrl({
            destination: 'Paris', checkin: '2026-06-15', checkout: '2026-06-17',
            adults: 2, rooms: 1, children: 0, offset: 0, currency: '', lang: '',
        });
        expect(url).toMatch(/booking\.com\/searchresults\.html\?/);
    });

    it('emits offset only when > 0', () => {
        const url = buildSearchUrl({
            destination: 'Paris', checkin: '2026-06-15', checkout: '2026-06-17',
            adults: 2, rooms: 1, children: 0, offset: 25, currency: '', lang: '',
        });
        expect(url).toContain('offset=25');
    });
});

describe('booking helpers — hasPositiveResultCount', () => {
    it('detects positive Booking result-count evidence', () => {
        expect(hasPositiveResultCount('Tokyo: 1,234 properties found')).toBe(true);
        expect(hasPositiveResultCount('1 stay found')).toBe(true);
    });

    it('does not treat no-results text as positive evidence', () => {
        expect(hasPositiveResultCount('No properties found')).toBe(false);
        expect(hasPositiveResultCount('0 properties found')).toBe(false);
    });
});

describe('booking search — typed errors (no silent fallback)', () => {
    it('respects offset for rank numbering when paginating', async () => {
        const search = getRegistry().get('booking/search');
        const pagedPage = {
            goto: async () => {},
            wait: async () => {},
            evaluate: async () => ({
                ok: true,
                blocked: false,
                totalText: '',
                items: [
                    { name: 'A', country: 'jp', slug: 'a', url: 'https://www.booking.com/hotel/jp/a.html', distance: '', review_score: null, review_count: null, star_rating: null, price_currency: '', price_amount: null, recommended_room: '' },
                    { name: 'B', country: 'jp', slug: 'b', url: 'https://www.booking.com/hotel/jp/b.html', distance: '', review_score: null, review_count: null, star_rating: null, price_currency: '', price_amount: null, recommended_room: '' },
                ],
            }),
        };
        const rows = await search.func(pagedPage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17', offset: 50 });
        expect(rows[0].rank).toBe(51);
        expect(rows[1].rank).toBe(52);
    });
});
