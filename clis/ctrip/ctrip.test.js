import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
import './hotel-suggest.js';
import './hotel-search.js';
import './flight.js';
import { __test__ as hotelSearchTest } from './hotel-search.js';
import {
    buildFlightExtractJs,
    buildScrollUntilJs,
    buildUrl,
    mapHotelRow,
    mapSuggestRow,
    parseCityId,
    parseIataCode,
    parseIsoDate,
    parseLimit,
    pickCoords,
    pickHotelMapCoords,
} from './utils.js';

function createPageMock(evaluateResults) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate,
        wait: vi.fn().mockResolvedValue(undefined),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue([]),
    };
}

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

describe('ctrip parseIsoDate', () => {
    it('accepts well-formed dates', () => {
        expect(parseIsoDate('checkin', '2026-06-15')).toBe('2026-06-15');
        expect(parseIsoDate('date', '2030-12-31')).toBe('2030-12-31');
    });
    it('rejects missing/blank with required-arg message', () => {
        expect(() => parseIsoDate('checkin', '')).toThrow(/--checkin is required/);
        expect(() => parseIsoDate('date', undefined)).toThrow(/--date is required/);
    });
    it('rejects malformed strings', () => {
        expect(() => parseIsoDate('checkin', '2026/06/15')).toThrow(/must be YYYY-MM-DD/);
        expect(() => parseIsoDate('checkin', 'tomorrow')).toThrow(/must be YYYY-MM-DD/);
    });
    it('rejects out-of-range month/day before Date math', () => {
        expect(() => parseIsoDate('checkin', '2026-13-01')).toThrow(/invalid month\/day/);
        expect(() => parseIsoDate('checkin', '2026-06-32')).toThrow(/invalid month\/day/);
    });
    it('rejects impossible calendar dates (Feb 30) via UTC cross-check', () => {
        expect(() => parseIsoDate('checkin', '2026-02-30')).toThrow(/not a real calendar date/);
        expect(() => parseIsoDate('checkin', '2025-02-29')).toThrow(/not a real calendar date/); // 2025 not leap
    });
});

describe('ctrip parseIataCode', () => {
    it('uppercases and accepts 3-letter codes', () => {
        expect(parseIataCode('from', 'pek')).toBe('PEK');
        expect(parseIataCode('from', 'BJS')).toBe('BJS');
        expect(parseIataCode('to', '  sha  ')).toBe('SHA');
    });
    it('rejects non-3-letter / mixed inputs', () => {
        expect(() => parseIataCode('from', 'PE')).toThrow(/3-letter IATA/);
        expect(() => parseIataCode('from', 'PEKK')).toThrow(/3-letter IATA/);
        expect(() => parseIataCode('from', '123')).toThrow(/3-letter IATA/);
        expect(() => parseIataCode('from', '')).toThrow(/required/);
    });
});

describe('ctrip parseCityId', () => {
    it('accepts positive integer city IDs (numeric and string)', () => {
        expect(parseCityId(2)).toBe(2);
        expect(parseCityId('1')).toBe(1);
        expect(parseCityId('12345')).toBe(12345);
    });
    it('rejects zero / negative / non-integer / empty', () => {
        expect(() => parseCityId(0)).toThrow(/positive integer/);
        expect(() => parseCityId(-1)).toThrow(/positive integer/);
        expect(() => parseCityId(2.5)).toThrow(/positive integer/);
        expect(() => parseCityId('shanghai')).toThrow(/positive integer/);
        expect(() => parseCityId('')).toThrow(/--city is required/);
    });
});

describe('ctrip pickHotelMapCoords', () => {
    it('prefers WGS84 (coordinateType=1) when multiple available', () => {
        const coords = [
            { coordinateType: 3, latitude: '31.25', longitude: '121.51' },
            { coordinateType: 1, latitude: '31.23', longitude: '121.47' },
            { coordinateType: 2, latitude: '31.24', longitude: '121.49' },
        ];
        expect(pickHotelMapCoords(coords)).toEqual({ lat: 31.23, lon: 121.47 });
    });
    it('falls through to GCJ02 then BD09 if WGS84 missing', () => {
        const onlyBD09 = [{ coordinateType: 3, latitude: '31.25', longitude: '121.51' }];
        expect(pickHotelMapCoords(onlyBD09)).toEqual({ lat: 31.25, lon: 121.51 });
    });
    it('returns null/null on empty / non-array / all-zero coords', () => {
        expect(pickHotelMapCoords([])).toEqual({ lat: null, lon: null });
        expect(pickHotelMapCoords(null)).toEqual({ lat: null, lon: null });
        expect(pickHotelMapCoords([{ coordinateType: 1, latitude: '0', longitude: '0' }])).toEqual({ lat: null, lon: null });
    });
});

describe('ctrip mapHotelRow', () => {
    const HOTEL_FIXTURE = {
        hotelInfo: {
            summary: { hotelId: '106876528' },
            nameInfo: { name: '上海外滩滨江珍宝酒店', enName: 'Shanghai Bund Riverside Treasury Hotel' },
            hotelStar: { star: 4 },
            commentInfo: { commentScore: '4.7', commentDescription: '超棒', commenterNumber: '13,966条点评' },
            positionInfo: {
                cityName: '上海',
                positionDesc: '北外滩地区 · 近北外滩来福士',
                address: '东大名路988号',
                mapCoordinate: [{ coordinateType: 3, latitude: '31.25693033446487', longitude: '121.51336547497098' }],
            },
        },
        roomInfo: [{ priceInfo: { price: 548, currency: 'RMB', displayPrice: '¥548' } }],
    };

    it('projects every declared column key (no silent drop)', () => {
        const row = mapHotelRow(HOTEL_FIXTURE, 0);
        expect(row).toEqual({
            rank: 1,
            hotelId: '106876528',
            name: '上海外滩滨江珍宝酒店',
            enName: 'Shanghai Bund Riverside Treasury Hotel',
            star: 4,
            score: 4.7,
            scoreLabel: '超棒',
            reviewCount: 13966,
            cityName: '上海',
            district: '北外滩地区 · 近北外滩来福士',
            address: '东大名路988号',
            lat: 31.25693033446487,
            lon: 121.51336547497098,
            price: 548,
            currency: 'RMB',
            url: 'https://hotels.ctrip.com/hotels/detail/?hotelid=106876528',
        });
    });

    it('returns null (not 0 / "") for missing optional fields', () => {
        const sparse = { hotelInfo: { summary: { hotelId: '999' }, nameInfo: { name: 'X' } }, roomInfo: [] };
        const row = mapHotelRow(sparse, 4);
        expect(row.rank).toBe(5);
        expect(row.star).toBeNull();
        expect(row.score).toBeNull();
        expect(row.reviewCount).toBeNull();
        expect(row.price).toBeNull();
        expect(row.currency).toBeNull();
        expect(row.lat).toBeNull();
        expect(row.lon).toBeNull();
        expect(row.address).toBeNull();
    });

    it('parses reviewCount from "13,966条点评" / "999 reviews" by stripping non-digits', () => {
        const a = mapHotelRow({ hotelInfo: { summary: { hotelId: '1' }, nameInfo: { name: 'A' }, commentInfo: { commenterNumber: '13,966条点评' } }, roomInfo: [] }, 0);
        expect(a.reviewCount).toBe(13966);
        const b = mapHotelRow({ hotelInfo: { summary: { hotelId: '2' }, nameInfo: { name: 'B' }, commentInfo: { commenterNumber: '999 reviews' } }, roomInfo: [] }, 0);
        expect(b.reviewCount).toBe(999);
    });
});

describe('ctrip hotel-search command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/hotel-search');

    const SHANGHAI_HOTEL = {
        hotelInfo: {
            summary: { hotelId: '106876528' },
            nameInfo: { name: '上海外滩滨江珍宝酒店' },
            hotelStar: { star: 4 },
            commentInfo: { commentScore: '4.7', commentDescription: '超棒', commenterNumber: '13,966条点评' },
            positionInfo: { cityName: '上海', address: '东大名路988号', mapCoordinate: [{ coordinateType: 1, latitude: '31.25', longitude: '121.51' }] },
        },
        roomInfo: [{ priceInfo: { price: 548, currency: 'RMB' } }],
    };

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('hotels.ctrip.com');
    });

    it('rejects invalid city / date / limit before browser navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { city: 'shanghai', checkin: '2026-06-15', checkout: '2026-06-17', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--city') });
        await expect(cmd.func(page, { city: 2, checkin: 'tomorrow', checkout: '2026-06-17', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--checkin') });
        await expect(cmd.func(page, { city: 2, checkin: '2026-06-15', checkout: '2026-06-17', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects checkin >= checkout before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { city: 2, checkin: '2026-06-17', checkout: '2026-06-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--checkin must be earlier') });
        await expect(cmd.func(page, { city: 2, checkin: '2026-06-15', checkout: '2026-06-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--checkin must be earlier') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when captcha gate is detected', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { city: 2, checkin: '2026-06-15', checkout: '2026-06-17', limit: 5 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        // No extract call when captcha caught early
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws EmptyResultError when SSR hotelList is empty', async () => {
        const page = createPageMock(['content', []]);
        await expect(cmd.func(page, { city: 9999, checkin: '2026-06-15', checkout: '2026-06-17', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('waits for an empty SSR hotelList so empty results do not become timeout failures', async () => {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', {
            url: 'https://hotels.ctrip.com/hotels/list?city=9999',
            runScripts: 'outside-only',
        });
        dom.window.__NEXT_DATA__ = {
            props: { pageProps: { initListData: { hotelList: [] } } },
        };
        await expect(dom.window.Function(`return (${hotelSearchTest.WAIT_FOR_SSR_JS})`)())
            .resolves.toBe('content');
    });

    it('throws CommandExecutionError when SSR state times out or is malformed', async () => {
        await expect(cmd.func(createPageMock(['timeout']), { city: 2, checkin: '2026-06-15', checkout: '2026-06-17', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not expose SSR hotel list') });
        await expect(cmd.func(createPageMock(['content', { hotelList: [] }]), { city: 2, checkin: '2026-06-15', checkout: '2026-06-17', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed SSR hotel list') });
    });

    it('maps SSR rows and respects --limit', async () => {
        const page = createPageMock([
            'content',
            [SHANGHAI_HOTEL, { ...SHANGHAI_HOTEL, hotelInfo: { ...SHANGHAI_HOTEL.hotelInfo, summary: { hotelId: '2' } } }],
        ]);
        const rows = await cmd.func(page, { city: 2, checkin: '2026-06-15', checkout: '2026-06-17', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, hotelId: '106876528', name: '上海外滩滨江珍宝酒店', star: 4, price: 548 });
        // Every declared column appears on every row
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        // Single goto, single URL
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('city=2');
        expect(page.goto.mock.calls[0][0]).toContain('checkin=2026-06-15');
        expect(page.goto.mock.calls[0][0]).toContain('checkout=2026-06-17');
    });

    it('filters out SSR rows missing hotelId or name (no silent partial rows)', async () => {
        const incomplete = { hotelInfo: { summary: {}, nameInfo: { name: 'No-id' } }, roomInfo: [] };
        const page = createPageMock(['content', [incomplete, SHANGHAI_HOTEL]]);
        const rows = await cmd.func(page, { city: 2, checkin: '2026-06-15', checkout: '2026-06-17', limit: 5 });
        expect(rows).toHaveLength(1);
        expect(rows[0].hotelId).toBe('106876528');
    });

    it('throws CommandExecutionError when all SSR rows miss required anchors', async () => {
        const incomplete = { hotelInfo: { summary: {}, nameInfo: { name: 'No-id' } }, roomInfo: [] };
        const page = createPageMock(['content', [incomplete]]);
        await expect(cmd.func(page, { city: 2, checkin: '2026-06-15', checkout: '2026-06-17', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('required hotelId/name anchors') });
    });
});

describe('ctrip flight command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/flight');

    const FLIGHT_RAW = {
        airline: '厦门航空',
        flightNo: 'MF8561',
        aircraft: '空客321(中)',
        departureTime: '07:50',
        departureAirport: '大兴国际机场',
        arrivalTime: '09:45',
        arrivalAirport: '浦东国际机场',
        terminal: 'T2',
        price: 487,
        currency: '¥',
        cabin: '经济舱',
    };

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('flights.ctrip.com');
    });

    it('rejects invalid IATA / date / from==to / limit before browser navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { from: 'PE', to: 'SHA', date: '2026-06-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('IATA') });
        await expect(cmd.func(page, { from: 'PEK', to: 'PEK', date: '2026-06-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('must differ') });
        await expect(cmd.func(page, { from: 'PEK', to: 'SHA', date: '06/15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--date') });
        await expect(cmd.func(page, { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when captcha gate is detected', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 5 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws EmptyResultError when DOM extraction returns no flights', async () => {
        const page = createPageMock(['content', 0, []]);
        await expect(cmd.func(page, { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('throws CommandExecutionError when visible cards render but parser finds no flight anchors', async () => {
        const page = createPageMock(['content', 2, []]);
        await expect(cmd.func(page, { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 5 }))
            .rejects.toMatchObject({
                code: 'COMMAND_EXEC',
                message: expect.stringContaining('parser did not find required flight anchors'),
            });
    });

    it('throws CommandExecutionError when flight render waits timeout or extraction is malformed', async () => {
        await expect(cmd.func(createPageMock(['timeout']), { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render flight cards') });
        await expect(cmd.func(createPageMock(['content', 1, { rows: [] }]), { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed rows') });
    });

    it('builds URL with lowercase IATA codes and Y_S_C_F cabin', async () => {
        const page = createPageMock(['content', 1, [FLIGHT_RAW]]);
        await cmd.func(page, { from: 'pek', to: 'sha', date: '2026-06-15', limit: 1 });
        const url = page.goto.mock.calls[0][0];
        expect(url).toContain('oneway-pek-sha');
        expect(url).toContain('depdate=2026-06-15');
        expect(url).toContain('cabin=Y_S_C_F');
        expect(url).toContain('adult=1');
    });

    it('maps DOM-extracted rows and respects --limit', async () => {
        const page = createPageMock([
            'content',
            2,
            [FLIGHT_RAW, { ...FLIGHT_RAW, flightNo: 'CA1234', airline: '国航' }],
        ]);
        const rows = await cmd.func(page, { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1,
            airline: '厦门航空',
            flightNo: 'MF8561',
            departureTime: '07:50',
            arrivalTime: '09:45',
            price: 487,
            currency: '¥',
            cabin: '经济舱',
        });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
    });

    it('filters out flight rows missing core anchors (no silent partial rows)', async () => {
        const page = createPageMock(['content', 2, [{ ...FLIGHT_RAW, departureTime: '' }, FLIGHT_RAW]]);
        const rows = await cmd.func(page, { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 5 });
        expect(rows).toHaveLength(1);
        expect(rows[0].departureTime).toBe('07:50');
    });

    it('throws CommandExecutionError when every flight row misses core anchors', async () => {
        const page = createPageMock(['content', 2, [{ ...FLIGHT_RAW, departureAirport: '' }, { ...FLIGHT_RAW, flightNo: null }]]);
        await expect(cmd.func(page, { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('required airline/flight/time/airport anchors') });
    });
});

describe('ctrip buildScrollUntilJs', () => {
    it('inlines the row selector + target count + default maxScrolls', () => {
        const js = buildScrollUntilJs('.flight-list > span > div', 20);
        expect(js).toContain('"\.flight-list > span > div"'.replace('\\.', '.')); // selector literal
        expect(js).toContain('countItems() >= 20');
        expect(js).toContain('i < 8');
        expect(js).toContain('plateauRounds');
        expect(js).toContain('getBoundingClientRect');
        expect(js).toContain('getComputedStyle');
    });
    it('respects a custom maxScrolls override', () => {
        const js = buildScrollUntilJs('.hotel-card', 50, 3);
        expect(js).toContain('countItems() >= 50');
        expect(js).toContain('i < 3');
    });
    it('rejects unsafe target / maxScrolls values before interpolation', () => {
        expect(() => buildScrollUntilJs('.hotel-card', 0)).toThrow('targetCount');
        expect(() => buildScrollUntilJs('.hotel-card', 101)).toThrow('targetCount');
        expect(() => buildScrollUntilJs('.hotel-card', 10, 0)).toThrow('maxScrolls');
        expect(() => buildScrollUntilJs('.hotel-card', 10, 31)).toThrow('maxScrolls');
    });
});

describe('ctrip buildFlightExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
            { url: 'https://flights.ctrip.com/' });
        const js = buildFlightExtractJs();
        return Function('document', `return (${js})`)(dom.window.document);
    }

    it('extracts a single ordered card via position-anchored chunks', () => {
        const html = `
          <div class="flight-list"><span>
            <div>
              <span>厦门航空</span><span>MF8561</span><span>空客321(中)</span>
              <span>当日低价</span>
              <span>07:50</span><span>大兴国际机场</span>
              <span>09:45</span><span>浦东国际机场</span><span>T2</span>
              <span>已减¥3</span><span>惊喜低价</span>
              <span>¥</span><span>487</span><span>起</span>
              <span>经济舱</span><span>订票</span>
            </div>
          </span></div>
        `;
        const rows = runExtract(html);
        expect(rows).toEqual([{
            airline: '厦门航空',
            flightNo: 'MF8561',
            aircraft: '空客321(中)',
            departureTime: '07:50',
            departureAirport: '大兴国际机场',
            arrivalTime: '09:45',
            arrivalAirport: '浦东国际机场',
            terminal: 'T2',
            price: 487,
            currency: '¥',
            cabin: '经济舱',
        }]);
    });

    it('omits terminal when not present after arrAirport', () => {
        const html = `
          <div class="flight-list"><span>
            <div>
              <span>国航</span><span>CA1234</span><span>波音737</span>
              <span>08:00</span><span>首都国际机场</span>
              <span>10:00</span><span>虹桥国际机场</span>
              <span>¥</span><span>520</span><span>起</span><span>经济舱</span>
            </div>
          </span></div>
        `;
        const rows = runExtract(html);
        expect(rows).toHaveLength(1);
        expect(rows[0].terminal).toBeNull();
        expect(rows[0].arrivalAirport).toBe('虹桥国际机场');
    });

    it('returns empty array when there are no flight cards (not a sentinel row)', () => {
        const rows = runExtract('<div class="flight-list"></div>');
        expect(rows).toEqual([]);
    });

    it('does not fabricate rows from non-flight cards with two times', () => {
        const html = `
          <div class="flight-list"><span>
            <div>
              <span>筛选</span><span>价格排序</span><span>推荐</span>
              <span>08:00</span><span>出发</span><span>10:00</span><span>到达</span>
              <span>¥</span><span>520</span><span>经济舱</span>
            </div>
          </span></div>
        `;
        expect(runExtract(html)).toEqual([]);
    });
});
