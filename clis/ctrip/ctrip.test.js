import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { prepareCommandArgs } from '../../src/execution.js';
import './search.js';
import './hotel-suggest.js';
import './hotel-search.js';
import './flight.js';
import './flight-round.js';
import './train.js';
import './hotel.js';
import './bus.js';
import './ferry.js';
import './cruise.js';
import './tour.js';
import './package.js';
import './attraction.js';
import { __test__ as flightTest } from './flight.js';
import { __test__ as hotelSearchTest } from './hotel-search.js';
import {
    buildAttractionExtractJs,
    buildAttractionPlaceUrl,
    buildBusExtractJs,
    buildBusListUrl,
    buildCruiseExtractJs,
    buildCruisePortLookupJs,
    buildCruiseSearchUrl,
    buildFerryExtractJs,
    buildFerryListUrl,
    buildFlightExtractJs,
    buildHotelDetailExtractJs,
    buildHotelDetailUrl,
    buildPackageListUrl,
    buildScrollUntilJs,
    buildTourListUrl,
    buildTrainExtractJs,
    buildTrainListUrl,
    buildUrl,
    buildVacationsExtractJs,
    buildWaitForAttractionsJs,
    mapHotelRow,
    mapSuggestRow,
    parseCityId,
    parseHotelId,
    parseIataCode,
    parseIsoDate,
    parseLimit,
    parseListLimit,
    parsePlaceName,
    pickCoords,
    pickHotelMapCoords,
    WAIT_FOR_HOTEL_DETAIL_JS,
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
        expect(() => parseLimit('abc')).toThrow('--limit must be a positive integer');
        expect(() => parseLimit(3.5)).toThrow('--limit must be a positive integer');
        expect(() => parseLimit('1e1')).toThrow('--limit must be a positive integer');
        expect(() => parseLimit(' 10 ')).toThrow('--limit must be a positive integer');
        expect(() => parseLimit('01')).toThrow('--limit must be a positive integer');
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

    it('surfaces malformed response shape as typed COMMAND_EXEC, not empty data', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok({
            Result: true, ErrorCode: 0, Response: {},
        }))));
        await expect(cmd.func({ query: '上海', limit: 3 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('searchResults'),
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
        expect(() => parseIsoDate('checkin', ' 2026-06-15 ')).toThrow(/must be YYYY-MM-DD/);
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
        expect(() => parseCityId('1e2')).toThrow(/positive integer/);
        expect(() => parseCityId(' 2 ')).toThrow(/positive integer/);
        expect(() => parseCityId('02')).toThrow(/positive integer/);
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
        const page = createPageMock(['content', 2, [{ ...FLIGHT_RAW, departureAirport: '' }, { ...FLIGHT_RAW, arrivalTime: '' }]]);
        await expect(cmd.func(page, { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('required airline/flight/time/airport anchors') });
    });

    it('keeps a row whose .flight-item card omits the flight number (flightNo null, not dropped)', async () => {
        const page = createPageMock(['content', 1, [{ ...FLIGHT_RAW, flightNo: null }]]);
        const rows = await cmd.func(page, { from: 'PEK', to: 'SHA', date: '2026-06-15', limit: 5 });
        expect(rows).toHaveLength(1);
        expect(rows[0].flightNo).toBeNull();
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

const ROUND_ITEM = `
  <div class="flight-item">
    <span>新海航｜海南航空</span>
    <span>19:00</span><span>虹桥国际机场</span><span>T2</span>
    <span>21:15</span><span>首都国际机场</span><span>T2</span>
    <span>¥</span><span>817</span><span>起</span>
    <span>往返总价</span><span>选为去程</span>
  </div>`;

describe('ctrip buildFlightExtractJs (round-trip .flight-item, optional flightNo)', () => {
    function runExtract(html, requireFlightNo) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
            { url: 'https://flights.ctrip.com/' });
        return Function('document', `return (${buildFlightExtractJs('.flight-item', requireFlightNo)})`)(dom.window.document);
    }

    it('extracts a round-trip card that omits the flight number (flightNo null, not dropped)', () => {
        expect(runExtract(ROUND_ITEM, false)).toEqual([{
            airline: '新海航｜海南航空',
            flightNo: null,
            aircraft: null,
            departureTime: '19:00',
            departureAirport: '虹桥国际机场',
            arrivalTime: '21:15',
            arrivalAirport: '首都国际机场',
            terminal: 'T2',
            price: 817,
            currency: '¥',
            cabin: null,
        }]);
    });

    it('still drops a flightNo-less card when requireFlightNo is true (one-way guard preserved)', () => {
        expect(runExtract(ROUND_ITEM, true)).toEqual([]);
    });
});

describe('ctrip flight-round command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/flight-round');

    const ROUND_RAW = {
        airline: '新海航｜海南航空',
        flightNo: null,
        aircraft: null,
        departureTime: '19:00',
        departureAirport: '虹桥国际机场',
        arrivalTime: '21:15',
        arrivalAirport: '首都国际机场',
        terminal: 'T2',
        price: 817,
        currency: '¥',
        cabin: null,
    };

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('flights.ctrip.com');
    });

    it('rejects invalid IATA / date / from==to / return-before-depart / limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { from: 'PE', to: 'SHA', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('IATA') });
        await expect(cmd.func(page, { from: 'PEK', to: 'PEK', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('must differ') });
        await expect(cmd.func(page, { from: 'PEK', to: 'SHA', depart: '08/15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--depart') });
        await expect(cmd.func(page, { from: 'PEK', to: 'SHA', depart: '2026-08-22', return: '2026-08-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('on or after') });
        await expect(cmd.func(page, { from: 'PEK', to: 'SHA', depart: '2026-08-15', return: '2026-08-22', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired on captcha, EmptyResult on no flights, CommandExec on drift / timeout / malformed', async () => {
        await expect(cmd.func(createPageMock(['captcha']), { from: 'SHA', to: 'BJS', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        await expect(cmd.func(createPageMock(['content', 0, []]), { from: 'SHA', to: 'BJS', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(cmd.func(createPageMock(['content', 2, []]), { from: 'SHA', to: 'BJS', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not find required flight anchors') });
        await expect(cmd.func(createPageMock(['timeout']), { from: 'SHA', to: 'BJS', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render flight cards') });
        await expect(cmd.func(createPageMock(['content', 1, { rows: [] }]), { from: 'SHA', to: 'BJS', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed rows') });
    });

    it('builds the round-<from>-<to> URL with the depart_return date pair', async () => {
        const page = createPageMock(['content', 1, [ROUND_RAW]]);
        await cmd.func(page, { from: 'sha', to: 'bjs', depart: '2026-08-15', return: '2026-08-22', limit: 1 });
        const url = page.goto.mock.calls[0][0];
        expect(url).toContain('round-sha-bjs');
        expect(url).toContain('depdate=2026-08-15_2026-08-22');
        expect(url).toContain('cabin=Y_S_C_F');
    });

    it('maps round-trip rows (flightNo may be null) and respects --limit', async () => {
        const page = createPageMock(['content', 2, [ROUND_RAW, { ...ROUND_RAW, departureTime: '20:15', price: 846 }]]);
        const rows = await cmd.func(page, { from: 'SHA', to: 'BJS', depart: '2026-08-15', return: '2026-08-22', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, airline: '新海航｜海南航空', flightNo: null, departureTime: '19:00', price: 817 });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
    });

    it('throws CommandExecutionError when every round-trip row misses core anchors', async () => {
        const page = createPageMock(['content', 2, [{ ...ROUND_RAW, airline: '' }, { ...ROUND_RAW, departureAirport: '' }]]);
        await expect(cmd.func(page, { from: 'SHA', to: 'BJS', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('required airline/flight/time/airport anchors') });
    });
});

describe('ctrip parsePlaceName', () => {
    it('accepts Chinese station / city names', () => {
        expect(parsePlaceName('from', '北京')).toBe('北京');
        expect(parsePlaceName('to', ' 上海虹桥 ')).toBe('上海虹桥');
    });

    it('rejects empty / control-char / over-long names', () => {
        expect(() => parsePlaceName('from', '')).toThrow('required');
        expect(() => parsePlaceName('from', undefined)).toThrow('required');
        expect(() => parsePlaceName('from', 'a'.repeat(21))).toThrow('not a valid place name');
        expect(() => parsePlaceName('from', 'bad\x01name')).toThrow('not a valid place name');
    });
});

describe('ctrip parseListLimit', () => {
    it('falls back to default for empty / undefined / null', () => {
        expect(parseListLimit(undefined)).toBe(20);
        expect(parseListLimit('')).toBe(20);
        expect(parseListLimit(undefined, 5)).toBe(5);
    });

    it('rejects out-of-range / non-integer values (no silent clamp)', () => {
        expect(() => parseListLimit(0)).toThrow('--limit');
        expect(() => parseListLimit(51)).toThrow('--limit');
        expect(() => parseListLimit(1.5)).toThrow('--limit');
        expect(() => parseListLimit('abc')).toThrow('--limit');
        expect(() => parseListLimit('1e1')).toThrow('--limit');
        expect(() => parseListLimit(' 10 ')).toThrow('--limit');
        expect(() => parseListLimit('01')).toThrow('--limit');
    });
});

describe('ctrip command-specific limit parsers', () => {
    it('rejects coercive string numerics consistently', () => {
        for (const bad of ['1e1', ' 10 ', '01']) {
            expect(() => flightTest.parseFlightLimit(bad)).toThrow('--limit');
            expect(() => hotelSearchTest.parseHotelLimit(bad)).toThrow('--limit');
        }
    });

    it('preserves raw CLI limit strings so adapter-level strict parsing can reject coercive forms', () => {
        const requiredArgsByName = {
            search: { query: '上海' },
            'hotel-suggest': { query: '汉庭' },
            'hotel-search': { city: '2', checkin: '2026-08-01', checkout: '2026-08-02' },
            flight: { from: 'PEK', to: 'SHA', date: '2026-08-01' },
            'flight-round': { from: 'SHA', to: 'BJS', depart: '2026-08-01', return: '2026-08-08' },
            train: { from: '北京', to: '上海', date: '2026-08-01' },
            bus: { from: '北京', to: '天津', date: '2026-08-01' },
            ferry: { from: '大连', to: '烟台', date: '2026-08-01' },
            cruise: { port: '上海' },
            tour: { destination: '北京' },
            package: { destination: '三亚' },
            attraction: { city: '1' },
        };
        for (const [name, requiredArgs] of Object.entries(requiredArgsByName)) {
            const cmd = getRegistry().get(`ctrip/${name}`);
            const limitArg = cmd.args.find((arg) => arg.name === 'limit');
            expect(limitArg?.type).not.toBe('int');
            expect(prepareCommandArgs(cmd, { ...requiredArgs, limit: '01' }).limit).toBe('01');
        }
    });
});

describe('ctrip buildTrainListUrl', () => {
    it('encodes station names and pins ticketType', () => {
        const url = buildTrainListUrl('北京', '上海', '2026-08-01');
        expect(url).toContain('https://trains.ctrip.com/webapp/train/list?');
        const qs = new URL(url).searchParams;
        expect(qs.get('dStationName')).toBe('北京');
        expect(qs.get('aStationName')).toBe('上海');
        expect(qs.get('dDate')).toBe('2026-08-01');
        expect(qs.get('ticketType')).toBe('1');
    });
});

describe('ctrip train command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/train');

    const TRAIN_RAW = {
        trainNo: 'G531',
        departureTime: '06:08',
        departureStation: '北京南',
        arrivalTime: '12:04',
        arrivalStation: '上海虹桥',
        duration: '5时56分',
        fromPrice: 626,
        seats: ['二等座有票', '一等座(抢)', '商务座(抢)'],
    };

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('trains.ctrip.com');
    });

    it('rejects invalid station / date / from==to / limit before browser navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { from: '', to: '上海', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { from: '北京', to: '北京', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('must differ') });
        await expect(cmd.func(page, { from: '北京', to: '上海', date: '08/01', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--date') });
        await expect(cmd.func(page, { from: '北京', to: '上海', date: '2026-08-01', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when captcha gate is detected', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { from: '北京', to: '上海', date: '2026-08-01', limit: 5 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError on render timeout and on malformed extraction', async () => {
        await expect(cmd.func(createPageMock(['timeout']), { from: '北京', to: '上海', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render train cards') });
        await expect(cmd.func(createPageMock(['content', 1, { rows: [] }]), { from: '北京', to: '上海', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed rows') });
    });

    it('throws EmptyResultError when no cards rendered, CommandExec when cards rendered but no anchors', async () => {
        await expect(cmd.func(createPageMock(['content', 0, []]), { from: '北京', to: '上海', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(cmd.func(createPageMock(['content', 3, []]), { from: '北京', to: '上海', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not find required train anchors') });
    });

    it('builds the encoded train-list URL from the raw station names', async () => {
        const page = createPageMock(['content', 1, [TRAIN_RAW]]);
        await cmd.func(page, { from: '北京', to: '上海', date: '2026-08-01', limit: 1 });
        const url = page.goto.mock.calls[0][0];
        expect(url).toContain('dStationName=%E5%8C%97%E4%BA%AC');
        expect(url).toContain('dDate=2026-08-01');
        expect(url).toContain('ticketType=1');
    });

    it('maps DOM-extracted rows, joins seats, and respects --limit', async () => {
        const page = createPageMock([
            'content',
            2,
            [TRAIN_RAW, { ...TRAIN_RAW, trainNo: 'G1', fromPrice: 661, seats: ['二等座有票'] }],
        ]);
        const rows = await cmd.func(page, { from: '北京', to: '上海', date: '2026-08-01', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1,
            trainNo: 'G531',
            departureTime: '06:08',
            departureStation: '北京南',
            arrivalTime: '12:04',
            arrivalStation: '上海虹桥',
            duration: '5时56分',
            fromPrice: 626,
            seats: '二等座有票 / 一等座(抢) / 商务座(抢)',
        });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
    });

    it('keeps missing seat availability as null instead of an empty-string sentinel', async () => {
        const page = createPageMock(['content', 1, [{ ...TRAIN_RAW, seats: [] }]]);
        const rows = await cmd.func(page, { from: '北京', to: '上海', date: '2026-08-01', limit: 1 });
        expect(rows[0].seats).toBeNull();
    });
});

describe('ctrip buildTrainExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
            { url: 'https://trains.ctrip.com/' });
        const js = buildTrainExtractJs();
        return Function('document', `return (${js})`)(dom.window.document);
    }

    const CARD = `
      <div class="card-white list-item">
        <div class="list-bd">
          <div class="from"><div class="time">06:08</div><div class="station">北京南</div></div>
          <div class="mid"><div class="haoshi">5时56分</div><div class="checi">G531<i class="ifont-cert"></i></div></div>
          <div class="to"><div class="time">12:04</div><div class="station">上海虹桥</div></div>
          <div class="rbox"><div class="price">626</div></div>
        </div>
        <ul class="surplus-list"><li>二等座有票</li><li>一等座(抢)</li><li>商务座(抢)</li></ul>
      </div>`;

    it('extracts a train card by stable class-keyed fields', () => {
        expect(runExtract(CARD)).toEqual([{
            trainNo: 'G531',
            departureTime: '06:08',
            departureStation: '北京南',
            arrivalTime: '12:04',
            arrivalStation: '上海虹桥',
            duration: '5时56分',
            fromPrice: 626,
            seats: ['二等座有票', '一等座(抢)', '商务座(抢)'],
        }]);
    });

    it('keeps fromPrice null when the price node is missing or non-numeric', () => {
        const noPrice = CARD.replace('<div class="price">626</div>', '<div class="price">--</div>');
        expect(runExtract(noPrice)[0].fromPrice).toBeNull();
    });

    it('drops cards missing the train number or endpoints (no sentinel rows)', () => {
        const noCheci = CARD.replace('G531<i class="ifont-cert"></i>', '');
        expect(runExtract(noCheci)).toEqual([]);
        expect(runExtract('<div class="card-white list-item"></div>')).toEqual([]);
    });
});

const HOTEL_DETAIL_SSR = {
    hotelBaseInfo: {
        masterHotelId: 375539,
        cityName: '上海',
        nameInfo: { name: '上海和平饭店', nameEn: '' },
        starInfo: { level: 5, type: 'star' },
    },
    hotelPositionInfo: { address: '上海黄浦区南京东路20号', lat: '31.244714', lng: '121.496056' },
    hotelComment: {
        comment: {
            score: '4.8',
            scoreDescription: '超棒',
            totalComment: 5920,
            scoreDetail: [
                { showName: '卫生', showScore: '4.8', showType: 'Cleanliness' },
                { showName: '设施', showScore: '4.8', showType: 'Amenities' },
                { showName: '环境', showScore: '4.8', showType: 'Location' },
                { showName: '服务', showScore: '4.8', showType: 'Service' },
            ],
        },
    },
    hotelFacilityBelt: {
        facilityList: [
            { code: 105, facilityDesc: '接机服务', icon: 'ic_pickup' },
            { code: 1, facilityDesc: '无线WIFI免费', icon: 'ic_wifi' },
        ],
    },
    hotelPolicyInfo: {
        checkInAndOut: {
            content: [
                { description: '入住时间： 15:00后', tags: [] },
                { description: '退房时间： 12:00前', tags: [] },
            ],
        },
    },
};

// Shape as projected by buildHotelDetailExtractJs (what page.evaluate returns).
const HOTEL_DETAIL_ROW = {
    hotelId: '375539',
    name: '上海和平饭店',
    enName: null,
    star: 5,
    score: 4.8,
    scoreLabel: '超棒',
    reviewCount: 5920,
    ratingBreakdown: '卫生 4.8 / 设施 4.8 / 环境 4.8 / 服务 4.8',
    facilities: '接机服务 / 无线WIFI免费',
    checkInOut: '入住时间： 15:00后 / 退房时间： 12:00前',
    cityName: '上海',
    address: '上海黄浦区南京东路20号',
    lat: 31.244714,
    lon: 121.496056,
};

describe('ctrip parseHotelId', () => {
    it('accepts a positive integer id as string or number', () => {
        expect(parseHotelId('375539')).toBe(375539);
        expect(parseHotelId(375539)).toBe(375539);
    });

    it('rejects blank, non-numeric, zero, negative, and fractional ids', () => {
        for (const bad of ['', '  ', 'abc', '375539a', '1e2', ' 375539 ', '0375539', 0, -5, 3.5]) {
            expect(() => parseHotelId(bad)).toThrow(/hotel id/);
        }
    });
});

describe('ctrip buildHotelDetailUrl', () => {
    it('builds the canonical lowercase-hotelid detail URL', () => {
        expect(buildHotelDetailUrl(375539)).toBe('https://hotels.ctrip.com/hotels/detail/?hotelid=375539');
    });
});

describe('ctrip hotel command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/hotel');

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('hotels.ctrip.com');
    });

    it('rejects a non-numeric / zero id before browser navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { id: 'shanghai' }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('hotel id') });
        await expect(cmd.func(page, { id: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when captcha gate is detected', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { id: 375539 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError on SSR timeout and on malformed extraction', async () => {
        await expect(cmd.func(createPageMock(['timeout']), { id: 375539 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not expose SSR hotel data') });
        await expect(cmd.func(createPageMock(['content', null]), { id: 375539 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed data') });
    });

    it('throws EmptyResultError when the SSR profile lacks id or name', async () => {
        await expect(cmd.func(createPageMock(['content', { hotelId: null, name: null }]), { id: 375539 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('maps the SSR profile into a single row carrying every declared column', async () => {
        const page = createPageMock(['content', HOTEL_DETAIL_ROW]);
        const rows = await cmd.func(page, { id: 375539 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            hotelId: '375539',
            name: '上海和平饭店',
            star: 5,
            score: 4.8,
            ratingBreakdown: '卫生 4.8 / 设施 4.8 / 环境 4.8 / 服务 4.8',
            facilities: '接机服务 / 无线WIFI免费',
            url: 'https://hotels.ctrip.com/hotels/detail/?hotelid=375539',
        });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('hotelid=375539');
    });
});

describe('ctrip buildHotelDetailExtractJs (JSDOM)', () => {
    function runExtract(nextData) {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', {
            url: 'https://hotels.ctrip.com/hotels/detail/?hotelid=375539',
            runScripts: 'outside-only',
        });
        dom.window.__NEXT_DATA__ = nextData;
        const js = buildHotelDetailExtractJs();
        return dom.window.Function(`return (${js})`)();
    }

    it('projects the hotel profile, joining sub-scores / facilities / policy', () => {
        const out = runExtract({ props: { pageProps: { hotelDetailResponse: HOTEL_DETAIL_SSR } } });
        expect(out).toEqual(HOTEL_DETAIL_ROW);
    });

    it('returns null when the SSR detail block is absent', () => {
        expect(runExtract({ props: { pageProps: {} } })).toBeNull();
    });

    it('detects the rendered SSR block as content via WAIT_FOR_HOTEL_DETAIL_JS', async () => {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', {
            url: 'https://hotels.ctrip.com/hotels/detail/?hotelid=375539',
            runScripts: 'outside-only',
        });
        dom.window.__NEXT_DATA__ = { props: { pageProps: { hotelDetailResponse: HOTEL_DETAIL_SSR } } };
        await expect(dom.window.Function(`return (${WAIT_FOR_HOTEL_DETAIL_JS})`)())
            .resolves.toBe('content');
    });
});

const BUS_CARD = `
  <div class="list-item-parent">
    <div class="cor333 fw-bold font16 list-width150 flex-row-start"><div class="margin-left20"></div>07:05</div>
    <div class="list-width200"><div class="list-item">
      <div class="flex-row-start"><img class="icon"><div class="font10 cor333 margin-left5">四惠客运站</div></div>
      <div class="flex-row-center margin-top8"><img class="icon"><div class="font10 cor333 margin-left5">马伸桥</div></div>
    </div></div>
    <div class="bus-desc"><div></div><div class="margin-top8">约2时30分</div></div>
    <div class="flex-row-start"><div class="font10 cor333 margin-top5">￥</div><div class="font18 fw-bold corred">50</div></div>
    <div class="flex-column-start"><div class="list-seat-parent bg-ccc">暂停网售</div></div>
  </div>`;

const BUS_RAW = {
    departureTime: '07:05',
    fromStation: '四惠客运站',
    toStation: '马伸桥',
    duration: '约2时30分',
    price: 50,
    status: '暂停网售',
};

describe('ctrip buildBusListUrl', () => {
    it('builds the newbus deep-link with a json param payload', () => {
        const url = buildBusListUrl('北京', '天津', '2026-08-01');
        expect(url.startsWith('https://bus.ctrip.com/list?param=')).toBe(true);
        const param = JSON.parse(decodeURIComponent(url.split('param=')[1]));
        expect(param).toEqual({ fromCity: '北京', toCity: '天津', fromDate: '2026-08-01', fromStation: '', toStation: '' });
    });
});

describe('ctrip bus command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/bus');

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('bus.ctrip.com');
    });

    it('rejects invalid city / date / from==to / limit before browser navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { from: '', to: '天津', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { from: '北京', to: '北京', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('must differ') });
        await expect(cmd.func(page, { from: '北京', to: '天津', date: '08/01', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--date') });
        await expect(cmd.func(page, { from: '北京', to: '天津', date: '2026-08-01', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when captcha gate is detected', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { from: '北京', to: '天津', date: '2026-08-01', limit: 5 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError on render timeout and on malformed extraction', async () => {
        await expect(cmd.func(createPageMock(['timeout']), { from: '北京', to: '天津', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render schedule rows') });
        await expect(cmd.func(createPageMock(['content', 1, { rows: [] }]), { from: '北京', to: '天津', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed rows') });
    });

    it('throws EmptyResultError when no rows rendered, CommandExec when rendered but no anchors', async () => {
        await expect(cmd.func(createPageMock(['content', 0, []]), { from: '北京', to: '天津', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(cmd.func(createPageMock(['content', 3, []]), { from: '北京', to: '天津', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not find required schedule anchors') });
    });

    it('builds the deep-link URL and maps rows respecting --limit', async () => {
        const page = createPageMock([
            'content',
            2,
            [BUS_RAW, { ...BUS_RAW, toStation: '仓上屯', price: 45 }],
        ]);
        const rows = await cmd.func(page, { from: '北京', to: '天津', date: '2026-08-01', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1,
            departureTime: '07:05',
            fromStation: '四惠客运站',
            toStation: '马伸桥',
            duration: '约2时30分',
            price: 50,
            status: '暂停网售',
        });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('bus.ctrip.com/list?param=');
    });
});

describe('ctrip buildBusExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
            { url: 'https://bus.ctrip.com/list' });
        const js = buildBusExtractJs();
        return Function('document', `return (${js})`)(dom.window.document);
    }

    it('extracts a coach row by stable utility-class fields', () => {
        expect(runExtract(BUS_CARD)).toEqual([BUS_RAW]);
    });

    it('keeps price null when the price node is missing or non-numeric', () => {
        const noPrice = BUS_CARD.replace('<div class="font18 fw-bold corred">50</div>', '<div class="font18 fw-bold corred">--</div>');
        expect(runExtract(noPrice)[0].price).toBeNull();
    });

    it('drops rows missing the time or either station (no sentinel rows)', () => {
        const noTime = BUS_CARD.replace('<div class="margin-left20"></div>07:05', '<div class="margin-left20"></div>');
        expect(runExtract(noTime)).toEqual([]);
        expect(runExtract('<div class="list-item-parent"></div>')).toEqual([]);
    });
});

const FERRY_CARD = `
  <div class="flex-row-center list-item-parent">
    <span class="list-width100">渤海晶珠</span>
    <div class="list-width400 flex-row-center center-column">
      <div class="flex-column-end flex1">
        <div class="cor333 font600 font16">09:00</div>
        <div class="cor333 font12 margin-top7">辽渔大连湾航运中心</div>
      </div>
      <div class="flex-row-center margin-bottom7"><div class="list-item-circle"></div><div class="list-item-line"></div><div class="list-item-circle"></div></div>
      <div class="flex1">
        <div class="flex-row-center"><div class="cor333 font600 font16">15:30</div></div>
        <div class="cor333 font12 margin-top7">烟台港客运站</div>
      </div>
    </div>
    <div class="flex1"></div>
    <span class="list-width100">6时30分</span>
    <div class="list-width100"><span>￥</span><span class="corred font15">220</span><span>起</span></div>
    <div class="list-width100 flex-column-end"><div class="list-seat-parent bg-ffb000">选择舱位</div></div>
  </div>`;

const FERRY_RAW = {
    shipName: '渤海晶珠',
    departureTime: '09:00',
    fromPort: '辽渔大连湾航运中心',
    arrivalTime: '15:30',
    toPort: '烟台港客运站',
    duration: '6时30分',
    price: 220,
    status: '选择舱位',
};

describe('ctrip buildFerryListUrl', () => {
    it('builds the ship deep-link with a json param payload', () => {
        const url = buildFerryListUrl('大连', '烟台', '2026-08-01');
        expect(url.startsWith('https://ship.ctrip.com/ship/list?param=')).toBe(true);
        const param = JSON.parse(decodeURIComponent(url.split('param=')[1]));
        expect(param).toEqual({ fromCityName: '大连', toCityName: '烟台', date: '2026-08-01' });
    });
});

describe('ctrip ferry command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/ferry');

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('ship.ctrip.com');
    });

    it('rejects invalid city / date / from==to / limit before browser navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { from: '', to: '烟台', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { from: '大连', to: '大连', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('must differ') });
        await expect(cmd.func(page, { from: '大连', to: '烟台', date: '08/01', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--date') });
        await expect(cmd.func(page, { from: '大连', to: '烟台', date: '2026-08-01', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when captcha gate is detected', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { from: '大连', to: '烟台', date: '2026-08-01', limit: 5 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError on render timeout and on malformed extraction', async () => {
        await expect(cmd.func(createPageMock(['timeout']), { from: '大连', to: '烟台', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render sailing rows') });
        await expect(cmd.func(createPageMock(['content', 1, { rows: [] }]), { from: '大连', to: '烟台', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed rows') });
    });

    it('throws EmptyResultError when no rows rendered, CommandExec when rendered but no anchors', async () => {
        await expect(cmd.func(createPageMock(['content', 0, []]), { from: '大连', to: '烟台', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(cmd.func(createPageMock(['content', 3, []]), { from: '大连', to: '烟台', date: '2026-08-01', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not find required sailing anchors') });
    });

    it('builds the deep-link URL and maps rows respecting --limit', async () => {
        const page = createPageMock([
            'content',
            2,
            [FERRY_RAW, { ...FERRY_RAW, shipName: '渤海玉珠', price: 200 }],
        ]);
        const rows = await cmd.func(page, { from: '大连', to: '烟台', date: '2026-08-01', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1,
            shipName: '渤海晶珠',
            departureTime: '09:00',
            fromPort: '辽渔大连湾航运中心',
            arrivalTime: '15:30',
            toPort: '烟台港客运站',
            duration: '6时30分',
            price: 220,
            status: '选择舱位',
        });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('ship.ctrip.com/ship/list?param=');
    });
});

describe('ctrip buildFerryExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
            { url: 'https://ship.ctrip.com/ship/list' });
        const js = buildFerryExtractJs();
        return Function('document', `return (${js})`)(dom.window.document);
    }

    it('extracts a ferry sailing by stable class-keyed fields', () => {
        expect(runExtract(FERRY_CARD)).toEqual([FERRY_RAW]);
    });

    it('keeps price null when the price node is missing or non-numeric', () => {
        const noPrice = FERRY_CARD.replace('<span class="corred font15">220</span>', '<span class="corred font15">--</span>');
        expect(runExtract(noPrice)[0].price).toBeNull();
    });

    it('drops rows missing the departure time or either port (no sentinel rows)', () => {
        const noPort = FERRY_CARD.replace('<div class="cor333 font12 margin-top7">烟台港客运站</div>', '');
        expect(runExtract(noPort)).toEqual([]);
        expect(runExtract('<div class="list-item-parent"></div>')).toEqual([]);
    });
});

const CRUISE_CARD = `
  <div class="route_info">
    <h2 class="route_title"><span class="route_info_star"><span>4</span><i class="icon_star"></i></span>MSC地中海邮轮·荣耀号·上海-那霸(冲绳)-上海·5天4晚</h2>
    <p class="route_setout"><span class="route_info_label">上海登船/离船</span></p>
    <p class="route_sailing"><span class="gray_font">推荐班期：</span><span class="txt_link_strong">2026 09-30</span> 周三</p>
    <div class="route_label_list"><span class="route_info_txt">免签</span><span class="route_info_txt">码头接送巴士</span></div>
    <div class="price_sale"><div class="route_price"><span class="price"><dfn>¥</dfn><span>3980</span>起/人</span></div></div>
  </div>`;

const CRUISE_RAW = {
    title: 'MSC地中海邮轮·荣耀号·上海-那霸(冲绳)-上海·5天4晚',
    star: 4,
    boarding: '上海登船/离船',
    sailingDate: '2026 09-30',
    tags: '免签 / 码头接送巴士',
    price: 3980,
};

const CRUISE_PORT_LINKS = `
  <a href="/newpackage/search/s2.html">上海港出发邮轮预订</a>
  <a href="/newpackage/search/s154.html">天津港出发邮轮预订</a>
  <a href="/newpackage/search/s340.html">威尼斯港出发邮轮预订</a>`;

describe('ctrip buildCruiseSearchUrl', () => {
    it('builds the legacy per-port search URL', () => {
        expect(buildCruiseSearchUrl('154')).toBe('https://cruise.ctrip.com/newpackage/search/s154.html');
    });
});

describe('ctrip buildCruisePortLookupJs (JSDOM)', () => {
    function runLookup(html, port) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
            { url: 'https://cruise.ctrip.com/newpackage/search/s2.html' });
        return Function('document', `return (${buildCruisePortLookupJs(port)})`)(dom.window.document);
    }

    it('resolves a port name to its sN code from the page links', () => {
        expect(runLookup(CRUISE_PORT_LINKS, '天津')).toBe('154');
        expect(runLookup(CRUISE_PORT_LINKS, '上海')).toBe('2');
        expect(runLookup(CRUISE_PORT_LINKS, '威尼斯')).toBe('340');
    });

    it('returns null when no listed port matches', () => {
        expect(runLookup(CRUISE_PORT_LINKS, '厦门')).toBeNull();
    });
});

describe('ctrip cruise command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/cruise');

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('cruise.ctrip.com');
    });

    it('rejects a blank / over-long port and invalid limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { port: '', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { port: '上海', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when captcha gate is detected on the index page', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { port: '上海', limit: 5 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws EmptyResultError when no listed port matches (before any port navigation)', async () => {
        const page = createPageMock(['content', null]);
        await expect(cmd.func(page, { port: '厦门', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        // Only the index page was loaded; the port page is never navigated.
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('throws EmptyResultError when the resolved port has no current sailings', async () => {
        const page = createPageMock(['content', '154', 'empty']);
        await expect(cmd.func(page, { port: '天津', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        // Index + resolved port page both navigated before the empty state.
        expect(page.goto).toHaveBeenCalledTimes(2);
    });

    it('maps rows for a port that is its own index (single navigation)', async () => {
        const page = createPageMock(['content', '2', [CRUISE_RAW]]);
        const rows = await cmd.func(page, { port: '上海', limit: 5 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, title: CRUISE_RAW.title, star: 4, price: 3980 });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('s2.html');
    });

    it('resolves a non-index port with a second navigation and maps rows', async () => {
        const page = createPageMock(['content', '340', 'content', [CRUISE_RAW]]);
        const rows = await cmd.func(page, { port: '威尼斯', limit: 5 });
        expect(rows).toHaveLength(1);
        expect(rows[0].url).toContain('s340.html');
        expect(page.goto).toHaveBeenCalledTimes(2);
        expect(page.goto.mock.calls[1][0]).toContain('s340.html');
    });

    it('throws CommandExecutionError when cards render but none parse (drift)', async () => {
        await expect(cmd.func(createPageMock(['content', '2', []]), { port: '上海', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not find required itinerary anchors') });
    });
});

describe('ctrip buildCruiseExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
            { url: 'https://cruise.ctrip.com/newpackage/search/s2.html' });
        return Function('document', `return (${buildCruiseExtractJs()})`)(dom.window.document);
    }

    it('extracts a cruise card, stripping the leading star digit from the title', () => {
        expect(runExtract(CRUISE_CARD)).toEqual([CRUISE_RAW]);
    });

    it('keeps price null when the price node is missing or non-numeric', () => {
        const noPrice = CRUISE_CARD.replace('<span>3980</span>', '<span>敬请期待</span>');
        expect(runExtract(noPrice)[0].price).toBeNull();
    });

    it('drops cards without a title (no sentinel rows)', () => {
        expect(runExtract('<div class="route_info"></div>')).toEqual([]);
    });
});

const TOUR_CARD = `
  <div class="list_product_item flex flex-row">
    <div class="list_product_right flex flex-col">
      <p class="list_product_title" title="北京5日4晚跟团游"><span>北京5日4晚跟团游</span></p>
      <p class="list_product_subtitle">封顶12人小团</p>
      <div class="list_label_box"><span class="list_label_blue"><span>0购物</span></span><span class="list_label_blue"><span>成团保障</span></span></div>
      <div class="list_tiny_comment_box">
        <span class="list_product_score"><span>4.7</span>分</span>
        <span class="list_product_travel">已售1968</span>
        <span class="list_product_comment">567条点评</span>
      </div>
    </div>
    <div class="list_pricetag_container"><span class="list_sr_price">¥3726</span></div>
  </div>`;

const TOUR_RAW = {
    title: '北京5日4晚跟团游',
    subtitle: '封顶12人小团',
    tags: '0购物 / 成团保障',
    score: 4.7,
    sold: 1968,
    reviews: 567,
    price: 3726,
};

describe('ctrip buildTourListUrl', () => {
    it('builds the vacations search URL with the sv destination param', () => {
        const url = buildTourListUrl('北京');
        expect(url.startsWith('https://vacations.ctrip.com/list/whole/sc.html?sv=')).toBe(true);
        expect(url).toContain('sv=%E5%8C%97%E4%BA%AC');
    });
});

describe('ctrip tour command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/tour');

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('vacations.ctrip.com');
    });

    it('rejects a blank destination and invalid limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { destination: '', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { destination: '北京', limit: 99 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when captcha gate is detected', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { destination: '北京', limit: 5 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws EmptyResultError on an empty destination, CommandExec on rendered-but-unparsed', async () => {
        await expect(cmd.func(createPageMock(['empty']), { destination: '无人区', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(cmd.func(createPageMock(['content', []]), { destination: '北京', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not find required package anchors') });
    });

    it('throws CommandExecutionError on render timeout and malformed extraction', async () => {
        await expect(cmd.func(createPageMock(['timeout']), { destination: '北京', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render package cards') });
        await expect(cmd.func(createPageMock(['content', { rows: [] }]), { destination: '北京', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed rows') });
    });

    it('maps rows and respects --limit', async () => {
        const page = createPageMock(['content', [TOUR_RAW, { ...TOUR_RAW, title: '北京5日4晚拼小团', price: 4253 }]]);
        const rows = await cmd.func(page, { destination: '北京', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, title: '北京5日4晚跟团游', score: 4.7, sold: 1968, reviews: 567, price: 3726 });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('sv=');
    });
});

describe('ctrip buildVacationsExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
            { url: 'https://vacations.ctrip.com/list/whole/sc.html' });
        return Function('document', `return (${buildVacationsExtractJs()})`)(dom.window.document);
    }

    it('extracts a vacations product card by stable class-keyed fields', () => {
        expect(runExtract(TOUR_CARD)).toEqual([TOUR_RAW]);
    });

    it('multiplies 万 counts on sold / reviews', () => {
        const wan = TOUR_CARD.replace('已售1968', '已售7.1万').replace('567条点评', '1.2万条点评');
        const row = runExtract(wan)[0];
        expect(row.sold).toBe(71000);
        expect(row.reviews).toBe(12000);
    });

    it('keeps numeric fields null when their nodes are missing', () => {
        const bare = `<div class="list_product_item"><p class="list_product_title" title="北京5日4晚跟团游"><span>北京5日4晚跟团游</span></p></div>`;
        const row = runExtract(bare)[0];
        expect(row).toMatchObject({ title: '北京5日4晚跟团游', score: null, sold: null, reviews: null, price: null, tags: null });
    });

    it('drops cards without a title (no sentinel rows)', () => {
        expect(runExtract('<div class="list_product_item"></div>')).toEqual([]);
    });
});

describe('ctrip buildPackageListUrl', () => {
    it('builds the vacations freetravel search URL with the sv destination param', () => {
        const url = buildPackageListUrl('三亚');
        expect(url.startsWith('https://vacations.ctrip.com/list/freetravel/sc.html?sv=')).toBe(true);
        expect(url).toContain('sv=%E4%B8%89%E4%BA%9A');
    });
});

describe('ctrip package command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/package');

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('vacations.ctrip.com');
    });

    it('rejects a blank destination and invalid limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { destination: '', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { destination: '三亚', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when captcha gate is detected', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { destination: '三亚', limit: 5 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws EmptyResultError on an empty destination, CommandExec on rendered-but-unparsed', async () => {
        await expect(cmd.func(createPageMock(['empty']), { destination: '无人区', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(cmd.func(createPageMock(['content', []]), { destination: '三亚', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not find required package anchors') });
    });

    it('navigates the freetravel search and maps rows respecting --limit', async () => {
        const page = createPageMock(['content', [TOUR_RAW, { ...TOUR_RAW, title: '三亚5日自由行', price: 2124 }]]);
        const rows = await cmd.func(page, { destination: '三亚', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, price: 3726 });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('list/freetravel/sc.html?sv=');
    });
});

const ATTRACTION_LINKS = `
  <div>
    <a href="/sight/beijing1/229.html?poiType=3">故宫博物院4.8分19.7w条点评穿越明清两朝的皇家宫殿群</a>
    <a href="/sight/beijing1/62722.html?poiType=3">中国国家博物馆1.3w条点评穿越千年看中华珍宝</a>
    <a href="/sight/beijing1/230.html?poiType=3">八达岭长城4.7分6.1w条点评不到长城非好汉</a>
  </div>`;

const ATTRACTION_RAW = {
    name: '故宫博物院',
    rating: 4.8,
    reviews: 197000,
    url: 'https://you.ctrip.com/sight/beijing1/229.html?poiType=3',
};

describe('ctrip buildAttractionPlaceUrl', () => {
    it('routes the place page by the numeric city id with a placeholder slug', () => {
        expect(buildAttractionPlaceUrl(1)).toBe('https://you.ctrip.com/place/dest1.html');
        expect(buildAttractionPlaceUrl(2)).toBe('https://you.ctrip.com/place/dest2.html');
    });
});

describe('ctrip attraction command (registry-level)', () => {
    const cmd = getRegistry().get('ctrip/attraction');

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('you.ctrip.com');
    });

    it('rejects a non-numeric city and invalid limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { city: '', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { city: 'beijing', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('city ID') });
        await expect(cmd.func(page, { city: '1', limit: 99 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when captcha gate is detected', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { city: '1', limit: 5 }))
            .rejects.toThrow('Ctrip is asking for a captcha');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExec on render timeout, malformed extraction, and rendered-but-unparsed', async () => {
        await expect(cmd.func(createPageMock(['timeout']), { city: '1', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render attraction links') });
        await expect(cmd.func(createPageMock(['content', { rows: [] }]), { city: '1', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed rows') });
        await expect(cmd.func(createPageMock(['content', []]), { city: '1', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not find required sight anchors') });
    });

    it('maps attraction rows against the sight detail URL and respects --limit', async () => {
        const page = createPageMock(['content', [ATTRACTION_RAW, { ...ATTRACTION_RAW, name: '八达岭长城', rating: 4.7 }]]);
        const rows = await cmd.func(page, { city: '1', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, name: '故宫博物院', rating: 4.8, reviews: 197000 });
        expect(rows[0].url).toBe('https://you.ctrip.com/sight/beijing1/229.html?poiType=3');
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toBe('https://you.ctrip.com/place/dest1.html');
    });
});

describe('ctrip buildAttractionExtractJs (JSDOM)', () => {
    function runExtract(html, cityId = '1') {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
            { url: 'https://you.ctrip.com/place/beijing1.html' });
        return Function('document', `return (${buildAttractionExtractJs(cityId)})`)(dom.window.document);
    }

    it('reads name / rating / reviews from each sight link, expanding 万 / w counts', () => {
        const rows = runExtract(ATTRACTION_LINKS);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toEqual(ATTRACTION_RAW);
        expect(rows[2]).toMatchObject({ name: '八达岭长城', rating: 4.7, reviews: 61000 });
    });

    it('keeps rating null when a sight lists only a review count', () => {
        const rows = runExtract(ATTRACTION_LINKS);
        expect(rows[1]).toMatchObject({ name: '中国国家博物馆', rating: null, reviews: 13000 });
    });

    it('scopes rows to the requested city, dropping other-city sight anchors', () => {
        const crossCity = '<a href="/sight/shanghai2/75.html">上海外滩4.7分3.2w条点评</a>';
        expect(runExtract(ATTRACTION_LINKS + crossCity, '1')).toHaveLength(3);
        expect(runExtract(crossCity, '1')).toEqual([]);
        expect(runExtract(crossCity, '2')).toHaveLength(1);
    });

    it('drops off-domain and non-https sight-like anchors', () => {
        const bait = `
          <a href="https://evil.example/sight/beijing1/229.html">假景点4.8分10条点评</a>
          <a href="http://you.ctrip.com/sight/beijing1/230.html">明文景点4.7分20条点评</a>`;
        expect(runExtract(bait)).toEqual([]);
    });

    it('dedupes repeated sight ids and drops links without a name or rating/review signature', () => {
        expect(runExtract(ATTRACTION_LINKS + ATTRACTION_LINKS)).toHaveLength(3);
        expect(runExtract('<a href="/sight/beijing1/229.html">4.8分</a>')).toEqual([]);
        expect(runExtract('<a href="/sight/beijing1/229.html">故宫博物院</a>')).toEqual([]);
    });
});

describe('ctrip buildWaitForAttractionsJs (JSDOM)', () => {
    it('detects the rendered city-scoped sight links as content', async () => {
        const dom = new JSDOM(`<!doctype html><html><body>${ATTRACTION_LINKS}</body></html>`, {
            url: 'https://you.ctrip.com/place/beijing1.html',
            runScripts: 'outside-only',
        });
        await expect(dom.window.Function(`return (${buildWaitForAttractionsJs('1')})`)())
            .resolves.toBe('content');
    });
});
