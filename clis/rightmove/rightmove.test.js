import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    RIGHTMOVE_ORIGIN,
    SEARCH_COLUMNS,
    buildSearchUrl,
    encodePolyline,
    normalizeBbox,
    normalizePolygon,
    propertyToRow,
    resolveLocationIdentifier,
} from './utils.js';
import './search.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('rightmove adapter — registration', () => {
    it('registers public search command with expected columns', () => {
        const cmd = getRegistry().get('rightmove/search');

        expect(cmd).toBeDefined();
        expect(cmd.browser).toBe(false);
        expect(cmd.strategy).toBe('public');
        expect(cmd.columns).toEqual(SEARCH_COLUMNS);
    });
});

describe('rightmove adapter — location lookup', () => {
    it('resolves the first LOS typeahead match into a locationIdentifier', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({
                matches: [{ id: '837246', type: 'POSTCODE', displayName: 'SW1A 1AA' }],
            }), { status: 200, headers: { 'content-type': 'application/json' } }),
        ));

        const result = await resolveLocationIdentifier('SW1A 1AA');

        expect(result).toEqual({
            id: '837246',
            type: 'POSTCODE',
            displayName: 'SW1A 1AA',
            identifier: 'POSTCODE^837246',
        });
        expect(fetch).toHaveBeenCalledWith(
            expect.objectContaining({ href: 'https://los.rightmove.co.uk/typeahead?query=SW1A+1AA&limit=10&exclude=STREET' }),
            expect.any(Object),
        );
    });

    it('maps an empty LOS match list to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ matches: [] }), { status: 200 }),
        ));

        await expect(resolveLocationIdentifier('nowhere')).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('treats malformed LOS payloads and matches as parser drift', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ results: [] }), { status: 200 }),
        ));
        await expect(resolveLocationIdentifier('SW1A 1AA')).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ matches: [{ displayName: 'SW1A 1AA' }] }), { status: 200 }),
        ));
        await expect(resolveLocationIdentifier('SW1A 1AA')).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('rightmove adapter — area helpers', () => {
    it('validates bbox as west,east,north,south', () => {
        expect(normalizeBbox('-0.26,-0.19,51.52,51.49')).toBe('-0.26,-0.19,51.52,51.49');
        expect(() => normalizeBbox('-0.19,-0.26,51.52,51.49')).toThrow(ArgumentError);
        expect(() => normalizeBbox('-0.26,-0.19,51.49,51.52')).toThrow(ArgumentError);
    });

    it('requires Rightmove pagination index to stay on 24-row page boundaries', async () => {
        const cmd = getRegistry().get('rightmove/search');
        await expect(cmd.func({ location: 'SW1A 1AA', index: 1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func({ location: 'SW1A 1AA', index: 25 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('encodes Google polyline points used by Rightmove USERDEFINEDAREA', () => {
        const points = [
            [51.51293, -0.24167],
            [51.51015, -0.24467],
            [51.50737, -0.24399],
            [51.50609, -0.24253],
            [51.50465, -0.23849],
            [51.50433, -0.23489],
            [51.50529, -0.23214],
            [51.50726, -0.23017],
            [51.51213, -0.23025],
            [51.51383, -0.2318],
            [51.51533, -0.23498],
            [51.51554, -0.23944],
            [51.5148, -0.2439],
            [51.51405, -0.2445],
            [51.51138, -0.24399],
            [51.51293, -0.24167],
        ];

        expect(encodePolyline(points)).toBe('yblyHlen@jPvQjPgC~FcH~GgX~@oU_EePiKiKm]NsItHkHzRi@zZrCzZtCvBtOeBuHoM');
        expect(normalizePolygon(JSON.stringify(points))).toBe('yblyHlen@jPvQjPgC~FcH~GgX~@oU_EePiKiKm]NsItHkHzRi@zZrCzZtCvBtOeBuHoM');
    });
});

describe('rightmove adapter — URL and row mapping', () => {
    it('builds listing search URLs with filters', () => {
        const url = buildSearchUrl({
            channel: 'BUY',
            sortType: '6',
            index: 24,
            limit: 24,
            radius: '1',
            includeSstc: true,
            minPrice: '500000',
            maxPrice: '1000000',
            minBeds: '2',
            maxBeds: '',
            locationIdentifier: 'POSTCODE^837246',
            searchLocation: 'SW1A 1AA',
        });

        expect(url.href).toBe(`${RIGHTMOVE_ORIGIN}/api/property-search/listing/search?sortType=6&areaSizeUnit=sqft&viewType=LIST&channel=BUY&transactionType=BUY&index=24&locationIdentifier=POSTCODE%5E837246&numberOfPropertiesPerPage=24&searchLocation=SW1A+1AA&useLocationIdentifier=true&radius=1&_includeSSTC=on&minPrice=500000&maxPrice=1000000&minBedrooms=2`);
    });

    it('maps Rightmove property data to compact rows', () => {
        const row = propertyToRow({
            id: 123,
            displayAddress: 'One Hyde Park',
            bedrooms: 5,
            bathrooms: 5,
            propertyTypeFullDescription: '5 bedroom apartment for sale',
            addedOrReduced: 'Reduced on 13/05/2026',
            location: { latitude: 51.5, longitude: -0.1 },
            price: { displayPrices: [{ displayPrice: '£60,000,000' }] },
            customer: { branchDisplayName: 'Global 1, London' },
            propertyUrl: '/properties/123#/?channel=RES_BUY',
        }, 7);

        expect(row).toEqual({
            rank: 7,
            id: 123,
            address: 'One Hyde Park',
            price: '£60,000,000',
            bedrooms: 5,
            bathrooms: 5,
            type: '5 bedroom apartment for sale',
            agent: 'Global 1, London',
            added: 'Reduced on 13/05/2026',
            latitude: 51.5,
            longitude: -0.1,
            url: `${RIGHTMOVE_ORIGIN}/properties/123#/?channel=RES_BUY`,
        });
    });

    it('fails closed when a listing lacks a round-trippable id or URL', () => {
        expect(() => propertyToRow({ displayAddress: 'No id', propertyUrl: '/properties/123' }, 1))
            .toThrow(CommandExecutionError);
        expect(() => propertyToRow({ id: 123, displayAddress: 'No URL' }, 1))
            .toThrow(CommandExecutionError);
        expect(() => propertyToRow({ id: 123, displayAddress: 'Off-domain URL', propertyUrl: 'https://example.com/properties/123' }, 1))
            .toThrow(CommandExecutionError);
        expect(() => propertyToRow({ id: 123, displayAddress: 'Mismatched URL', propertyUrl: '/properties/456#/?channel=RES_BUY' }, 1))
            .toThrow(CommandExecutionError);
    });
});

describe('rightmove adapter — command runtime', () => {
    it('looks up a postcode, fetches listings, and maps rows', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                matches: [{ id: '837246', type: 'POSTCODE', displayName: 'SW1A 1AA' }],
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                properties: [{
                    id: 456,
                    displayAddress: 'Buckingham Gate, London',
                    bedrooms: 2,
                    bathrooms: 1,
                    propertyTypeFullDescription: '2 bedroom flat for sale',
                    price: { displayPrices: [{ displayPrice: '£1,000,000' }] },
                    customer: { branchDisplayName: 'Example Agent' },
                    propertyUrl: '/properties/456#/?channel=RES_BUY',
                }],
            }), { status: 200 })));

        const cmd = getRegistry().get('rightmove/search');
        const rows = await cmd.func({ location: 'SW1A 1AA', radius: 1, limit: 1 });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1,
            id: 456,
            address: 'Buckingham Gate, London',
            price: '£1,000,000',
        });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(String(fetch.mock.calls[1][0])).toContain('locationIdentifier=POSTCODE%5E837246');
        expect(String(fetch.mock.calls[1][0])).toContain('radius=1');
    });

    it('uses bbox without location lookup', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({
                properties: [{
                    id: 789,
                    displayAddress: 'Bonchurch Road, London',
                    price: { displayPrices: [{ displayPrice: '£900,000' }] },
                    propertyUrl: '/properties/789#/?channel=RES_BUY',
                }],
            }), { status: 200 }),
        ));

        const cmd = getRegistry().get('rightmove/search');
        const rows = await cmd.func({ bbox: '-0.26,-0.19,51.52,51.49', limit: 1 });

        expect(rows[0]).toMatchObject({ id: 789, address: 'Bonchurch Road, London' });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(String(fetch.mock.calls[0][0])).toContain('locationIdentifier=LAT_LONG_BOX%5E-0.26%2C-0.19%2C51.52%2C51.49');
    });
});
