import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import './hotel-suggest.js';
import { buildUrl, mapSuggestRow, parseLimit, pickCoords } from './utils.js';

function ok(payload) {
    return new Response(JSON.stringify(payload), { status: 200 });
}

const SHANGHAI_CITY = {
    id: '2', type: 'City', word: '上海', cityId: 2, cityName: '上海',
    provinceName: '上海', countryName: '中国', cityEName: 'Shanghai',
    countryEName: 'China', displayName: '上海, 中国', displayType: '城市',
    eName: 'Shanghai', commentScore: 0,
    lat: 0, lon: 0, gLat: 0, gLon: 0, gdLat: 31.2304, gdLon: 121.4737,
};

const FORBIDDEN_CITY = {
    id: '4189051', type: 'Markland', word: '故宫博物院', cityId: 1, cityName: '北京',
    provinceName: '北京', countryName: '中国', displayName: '故宫博物院, 北京, 中国',
    displayType: '地标', eName: 'The Palace Museum', commentScore: 4.8, cStar: 0,
    lat: 0, lon: 0, gLat: 0, gLon: 0, gdLat: 39.9177, gdLon: 116.397,
};

const HANOI_LANDMARK = {
    id: '6790582', type: 'Markland', word: '升龙皇城', cityId: 286, cityName: '河内',
    provinceName: '', countryName: '越南', displayName: '升龙皇城, 河内, 越南',
    displayType: '地标', eName: 'Imperial Citadel of Thang Long', commentScore: 0,
    lat: 0, lon: 0, gLat: 21.0352, gLon: 105.8403, gdLat: 0, gdLon: 0,
};

const HOTEL_ROW = {
    id: '133133582', type: 'Hotel', word: '汉庭酒店上海陆家嘴店', cityId: 2,
    cityName: '上海', provinceName: '上海', countryName: '中国',
    displayName: '汉庭酒店上海陆家嘴店, 上海, 中国', displayType: '酒店',
    cStar: 4.2, commentScore: 0,
};

describe('ctrip parseLimit', () => {
    it('returns fallback for undefined / null / empty', () => {
        expect(parseLimit(undefined)).toBe(15);
        expect(parseLimit(null)).toBe(15);
        expect(parseLimit('')).toBe(15);
    });
    it('accepts integers in [1, 50]', () => {
        expect(parseLimit(1)).toBe(1);
        expect(parseLimit(50)).toBe(50);
        expect(parseLimit('25')).toBe(25);
    });
    it('rejects non-integer', () => {
        expect(() => parseLimit('abc')).toThrow('--limit must be an integer');
        expect(() => parseLimit(3.5)).toThrow('--limit must be an integer');
    });
    it('rejects out-of-range without silent clamp', () => {
        expect(() => parseLimit(0)).toThrow('--limit must be between 1 and 50, got 0');
        expect(() => parseLimit(51)).toThrow('--limit must be between 1 and 50, got 51');
        expect(() => parseLimit(-3)).toThrow('--limit must be between 1 and 50');
    });
});

describe('ctrip pickCoords', () => {
    it('prefers gd coords (mainland) when present', () => {
        expect(pickCoords(SHANGHAI_CITY)).toEqual({ lat: 31.2304, lon: 121.4737 });
    });
    it('falls back to g coords (international) when gd is zero', () => {
        expect(pickCoords(HANOI_LANDMARK)).toEqual({ lat: 21.0352, lon: 105.8403 });
    });
    it('returns null/null when all coord variants are zero', () => {
        expect(pickCoords(HOTEL_ROW)).toEqual({ lat: null, lon: null });
    });
});

describe('ctrip buildUrl', () => {
    it('constructs city URL', () => {
        expect(buildUrl(SHANGHAI_CITY)).toBe('https://you.ctrip.com/place/%E4%B8%8A%E6%B5%B72.html');
    });
    it('constructs landmark URL', () => {
        expect(buildUrl(FORBIDDEN_CITY)).toBe('https://you.ctrip.com/sight/%E5%8C%97%E4%BA%AC1/4189051.html');
    });
    it('constructs hotel URL', () => {
        expect(buildUrl(HOTEL_ROW)).toBe('https://hotels.ctrip.com/hotels/detail/?hotelid=133133582');
    });
    it('returns null for unknown type rather than fabricating', () => {
        expect(buildUrl({ type: 'WhoKnows', id: '1', cityId: 1, cityName: 'X' })).toBeNull();
    });
});

describe('ctrip mapSuggestRow', () => {
    it('preserves all geo / english / id columns (no silent column drop)', () => {
        const row = mapSuggestRow(FORBIDDEN_CITY, 0);
        expect(row).toEqual({
            rank: 1,
            id: '4189051',
            type: 'Markland',
            displayType: '地标',
            name: '故宫博物院, 北京, 中国',
            eName: 'The Palace Museum',
            cityId: 1,
            cityName: '北京',
            provinceName: '北京',
            countryName: '中国',
            lat: 39.9177,
            lon: 116.397,
            score: 4.8,
            url: 'https://you.ctrip.com/sight/%E5%8C%97%E4%BA%AC1/4189051.html',
        });
    });
    it('uses cStar as score fallback when commentScore is 0', () => {
        const row = mapSuggestRow({ ...FORBIDDEN_CITY, commentScore: 0, cStar: 4.5 }, 2);
        expect(row.score).toBe(4.5);
    });
    it('returns null score when both commentScore and cStar are missing/zero', () => {
        expect(mapSuggestRow(SHANGHAI_CITY, 0).score).toBeNull();
    });
});

describe('ctrip search command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/search');
    beforeEach(() => vi.unstubAllGlobals());

    it('declares Strategy.PUBLIC + browser:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(false);
        expect(String(cmd.strategy)).toContain('public');
    });

    it('maps live response with full column shape', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({
            Result: true, ErrorCode: 0,
            Response: { searchResults: [SHANGHAI_CITY, FORBIDDEN_CITY] },
        }))));
        const rows = await cmd.func({ query: '上海', limit: 5 });
        expect(rows).toHaveLength(2);
        expect(rows[0].cityId).toBe(2);
        expect(rows[0].lat).toBeCloseTo(31.2304);
        expect(rows[1].url).toContain('/sight/');
        // shape parity: every row has every declared column key
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
    });

    it('rejects empty query with ArgumentError', async () => {
        await expect(cmd.func({ query: '   ', limit: 3 })).rejects.toThrow('Search keyword cannot be empty');
    });

    it('surfaces fetch failures as typed FETCH_ERROR', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 503 }))));
        await expect(cmd.func({ query: '上海', limit: 3 })).rejects.toMatchObject({
            code: 'FETCH_ERROR',
        });
    });

    it('wraps network failures as typed FETCH_ERROR', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('socket hang up'))));
        await expect(cmd.func({ query: '上海', limit: 3 })).rejects.toMatchObject({
            code: 'FETCH_ERROR',
            message: expect.stringContaining('socket hang up'),
        });
    });

    it('wraps invalid JSON as typed COMMAND_EXEC', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('not json', { status: 200 }))));
        await expect(cmd.func({ query: '上海', limit: 3 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('invalid JSON'),
        });
    });

    it('surfaces in-band Result=false as typed COMMAND_EXEC', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({
            Result: false, ErrorCode: 17,
        }))));
        await expect(cmd.func({ query: '上海', limit: 3 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
        });
    });

    it('surfaces empty results as EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({
            Result: true, ErrorCode: 0, Response: { searchResults: [] },
        }))));
        await expect(cmd.func({ query: '上海', limit: 3 })).rejects.toThrow('ctrip search returned no data');
    });

    it('rejects --limit 0 / 51 with ArgumentError (no silent clamp)', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({
            Result: true, ErrorCode: 0, Response: { searchResults: [SHANGHAI_CITY] },
        }))));
        await expect(cmd.func({ query: '上海', limit: 0 })).rejects.toThrow('--limit');
        await expect(cmd.func({ query: '上海', limit: 51 })).rejects.toThrow('--limit');
    });
});

describe('ctrip hotel-suggest command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/hotel-suggest');
    beforeEach(() => vi.unstubAllGlobals());

    it('declares Strategy.PUBLIC + browser:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(false);
        expect(String(cmd.strategy)).toContain('public');
    });

    it('maps Hotel rows with hotel detail URL', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({
            Result: true, ErrorCode: 0,
            Response: { searchResults: [SHANGHAI_CITY, HOTEL_ROW] },
        }))));
        const rows = await cmd.func({ query: '汉庭', limit: 5 });
        expect(rows).toHaveLength(2);
        const hotel = rows.find((r) => r.type === 'Hotel');
        expect(hotel.url).toBe('https://hotels.ctrip.com/hotels/detail/?hotelid=133133582');
    });

    it('passes searchType=H to the upstream endpoint', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(ok({
            Result: true, ErrorCode: 0,
            Response: { searchResults: [HOTEL_ROW] },
        })));
        vi.stubGlobal('fetch', fetchMock);
        await cmd.func({ query: '汉庭', limit: 5 });
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.searchType).toBe('H');
    });

    it('surfaces empty hotel-context lookup as EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({
            Result: true, ErrorCode: 0, Response: { searchResults: [] },
        }))));
        await expect(cmd.func({ query: 'zzz', limit: 5 })).rejects.toThrow('ctrip hotel-suggest returned no data');
    });
});
