import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
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

describe('booking adapter registry shape', () => {
    it('search is registered as read with id-shaped column for round-trip', () => {
        const search = getRegistry().get('booking/search');
        expect(search).toBeDefined();
        expect(search.access).toBe('read');
        expect(search.browser).toBe(true);
        // slug + country together form the round-trip identity (URL: /hotel/<country>/<slug>.html)
        expect(search.columns).toContain('slug');
        expect(search.columns).toContain('country');
        expect(search.columns).toContain('url');
    });

    it('search columns stay <= 12 to honor agent-native row shape', () => {
        const search = getRegistry().get('booking/search');
        expect(search.columns.length).toBeLessThanOrEqual(12);
    });
});

describe('booking search — typed errors (no silent fallback)', () => {
    const fakePage = { goto: () => { throw new Error('should not navigate'); } };

    it('rejects empty destination with ArgumentError', async () => {
        const search = getRegistry().get('booking/search');
        await expect(search.func(fakePage, { destination: '   ', checkin: '2026-06-15', checkout: '2026-06-17' })).rejects.toThrow(ArgumentError);
    });

    it('rejects missing checkin/checkout with ArgumentError', async () => {
        const search = getRegistry().get('booking/search');
        await expect(search.func(fakePage, { destination: 'Tokyo' })).rejects.toThrow(ArgumentError);
        await expect(search.func(fakePage, { destination: 'Tokyo', checkin: '2026-06-15' })).rejects.toThrow(ArgumentError);
    });

    it('rejects checkout <= checkin with ArgumentError', async () => {
        const search = getRegistry().get('booking/search');
        await expect(search.func(fakePage, { destination: 'Tokyo', checkin: '2026-06-17', checkout: '2026-06-15' })).rejects.toThrow(ArgumentError);
        await expect(search.func(fakePage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-15' })).rejects.toThrow(ArgumentError);
    });

    it('rejects out-of-range --limit with ArgumentError (no silent clamp to 100)', async () => {
        const search = getRegistry().get('booking/search');
        await expect(search.func(fakePage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17', limit: 999 })).rejects.toThrow(ArgumentError);
    });

    it('rejects negative --offset with ArgumentError', async () => {
        const search = getRegistry().get('booking/search');
        await expect(search.func(fakePage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17', offset: -1 })).rejects.toThrow(ArgumentError);
    });

    it('rejects unsupported --lang with ArgumentError', async () => {
        const search = getRegistry().get('booking/search');
        await expect(search.func(fakePage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17', lang: 'xx-yy' })).rejects.toThrow(ArgumentError);
    });

    it('rejects malformed --currency with ArgumentError', async () => {
        const search = getRegistry().get('booking/search');
        await expect(search.func(fakePage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17', currency: 'US$' })).rejects.toThrow(ArgumentError);
    });

    it('wraps browser navigation failures as CommandExecutionError', async () => {
        const search = getRegistry().get('booking/search');
        const downPage = { goto: () => Promise.reject(new Error('browser down')) };
        await expect(search.func(downPage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when extractor returns no cards', async () => {
        const search = getRegistry().get('booking/search');
        const emptyPage = {
            goto: async () => {},
            wait: async () => {},
            evaluate: async () => ({ ok: true, items: [], blocked: false, totalText: 'No properties found' }),
        };
        await expect(search.func(emptyPage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17' })).rejects.toThrow(EmptyResultError);
    });

    it('throws CommandExecutionError when result-count evidence exists but no cards were parsed', async () => {
        const search = getRegistry().get('booking/search');
        const driftPage = {
            goto: async () => {},
            wait: async () => {},
            evaluate: async () => ({ ok: true, items: [], blocked: false, totalText: 'Tokyo: 1,234 properties found' }),
        };
        await expect(search.func(driftPage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws CommandExecutionError when captcha is detected', async () => {
        const search = getRegistry().get('booking/search');
        const blockedPage = {
            goto: async () => {},
            wait: async () => {},
            evaluate: async () => ({ ok: true, items: [], blocked: true, totalText: 'Verify you are human' }),
        };
        await expect(search.func(blockedPage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws CommandExecutionError when extractor payload is malformed instead of treating it as empty', async () => {
        const search = getRegistry().get('booking/search');
        const malformedPage = {
            goto: async () => {},
            wait: async () => {},
            evaluate: async () => ({ ok: true, blocked: false, totalText: 'Tokyo hotels' }),
        };
        await expect(search.func(malformedPage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws CommandExecutionError when rendered cards lack stable hotel URL identity', async () => {
        const search = getRegistry().get('booking/search');
        const driftPage = {
            goto: async () => {},
            wait: async () => {},
            evaluate: async () => ({
                ok: true,
                blocked: false,
                totalText: 'Tokyo hotels',
                items: [{
                    name: 'Unlinked Hotel',
                    country: '',
                    slug: '',
                    url: '',
                    distance: '',
                    review_score: null,
                    review_count: null,
                    star_rating: null,
                    price_currency: '',
                    price_amount: null,
                    recommended_room: '',
                }],
            }),
        };
        await expect(search.func(driftPage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17' })).rejects.toThrow(CommandExecutionError);
    });

    it('unwraps {session, data} envelope from CDP bridge before validating', async () => {
        const search = getRegistry().get('booking/search');
        const envelopePage = {
            goto: async () => {},
            wait: async () => {},
            evaluate: async () => ({
                session: 1,
                data: {
                    ok: true,
                    blocked: false,
                    totalText: '',
                    items: [{
                        name: 'Test Hotel',
                        country: 'jp',
                        slug: 'test-hotel',
                        url: 'https://www.booking.com/hotel/jp/test-hotel.html',
                        distance: '1 km from centre',
                        review_score: 8.6,
                        review_count: 100,
                        star_rating: 4,
                        price_currency: 'USD',
                        price_amount: 120,
                        recommended_room: 'Standard double',
                    }],
                },
            }),
        };
        const rows = await search.func(envelopePage, { destination: 'Tokyo', checkin: '2026-06-15', checkout: '2026-06-17' });
        expect(rows).toHaveLength(1);
        expect(rows[0].rank).toBe(1);
        expect(rows[0].slug).toBe('test-hotel');
        expect(rows[0].url).toBe('https://www.booking.com/hotel/jp/test-hotel.html');
    });

    it('uses requested selected_currency as the output source when price is present', async () => {
        const search = getRegistry().get('booking/search');
        const currencyPage = {
            goto: async () => {},
            wait: async () => {},
            evaluate: async () => ({
                ok: true,
                blocked: false,
                totalText: '',
                items: [{
                    name: 'Currency Hotel',
                    country: 'cn',
                    slug: 'currency-hotel',
                    url: 'https://www.booking.com/hotel/cn/currency-hotel.html',
                    distance: '',
                    review_score: null,
                    review_count: null,
                    star_rating: null,
                    price_currency: 'JPY',
                    price_amount: 880,
                    recommended_room: '',
                }],
            }),
        };
        const rows = await search.func(currencyPage, { destination: 'Shanghai', checkin: '2026-06-15', checkout: '2026-06-17', currency: 'CNY' });
        expect(rows[0].price_currency).toBe('CNY');
    });

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
