import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './flight.js';
import './flight-round.js';
import './hotel-search.js';
import './hotel.js';
import './attraction.js';
import './train.js';
import './car.js';
import './transfer.js';
import './tour.js';
import './search.js';
import './package.js';
import './deals.js';
import {
    WAIT_FOR_ATTRACTIONS_JS,
    WAIT_FOR_CARS_JS,
    WAIT_FOR_DEALS_JS,
    WAIT_FOR_HOTEL_DETAIL_JS,
    WAIT_FOR_TRAINS_JS,
    WAIT_FOR_TRANSFERS_JS,
    buildAttractionExtractJs,
    buildAttractionSearchUrl,
    buildCarExtractJs,
    buildCarListUrl,
    buildDealsExtractJs,
    buildDealsUrl,
    buildFlightExtractJs,
    buildFlightRoundSearchUrl,
    buildFlightSearchUrl,
    buildHotelDetailExtractJs,
    buildHotelDetailUrl,
    buildHotelExtractJs,
    buildHotelSearchUrl,
    buildTourSearchJs,
    buildTourSearchUrl,
    buildTrainExtractJs,
    buildTrainRouteUrl,
    buildTransferExtractJs,
    buildTransferListUrl,
    fetchPoiSearch,
    flattenPoiResults,
    mapPackageRow,
    mapSearchRow,
    parseCityId,
    parseHotelId,
    parseIataCode,
    parseIsoDate,
    parseKeyword,
    parseListLimit,
    resolvePackageCity,
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
    };
}

describe('trip parseIataCode', () => {
    it('uppercases valid 3-letter codes', () => {
        expect(parseIataCode('from', 'lon')).toBe('LON');
        expect(parseIataCode('to', 'JFK')).toBe('JFK');
    });
    it('rejects empty / malformed codes', () => {
        expect(() => parseIataCode('from', '')).toThrow('required');
        expect(() => parseIataCode('from', 'LO')).toThrow('3-letter IATA');
        expect(() => parseIataCode('from', 'LOND')).toThrow('3-letter IATA');
    });
});

describe('trip parseIsoDate', () => {
    it('accepts real calendar dates', () => {
        expect(parseIsoDate('date', '2026-08-15')).toBe('2026-08-15');
    });
    it('rejects malformed / impossible dates', () => {
        expect(() => parseIsoDate('date', '08/15')).toThrow('YYYY-MM-DD');
        expect(() => parseIsoDate('date', '2026-02-30')).toThrow('not a real calendar date');
        expect(() => parseIsoDate('date', '')).toThrow('required');
    });
});

describe('trip parseListLimit', () => {
    it('falls back for empty / undefined', () => {
        expect(parseListLimit(undefined)).toBe(20);
        expect(parseListLimit('')).toBe(20);
        expect(parseListLimit(undefined, 5)).toBe(5);
    });
    it('rejects out-of-range / non-integer (no silent clamp)', () => {
        expect(() => parseListLimit(0)).toThrow('--limit');
        expect(() => parseListLimit(51)).toThrow('--limit');
        expect(() => parseListLimit('abc')).toThrow('--limit');
    });
});

describe('trip buildFlightSearchUrl', () => {
    it('lowercases codes and pins one-way English/USD params', () => {
        const url = buildFlightSearchUrl('LON', 'NYC', '2026-08-15');
        const qs = new URL(url).searchParams;
        expect(url).toContain('https://www.trip.com/flights/showfarefirst?');
        expect(qs.get('dcity')).toBe('lon');
        expect(qs.get('acity')).toBe('nyc');
        expect(qs.get('ddate')).toBe('2026-08-15');
        expect(qs.get('triptype')).toBe('ow');
        expect(qs.get('locale')).toBe('en_US');
        expect(qs.get('curr')).toBe('USD');
    });
});

describe('trip flight command (registry-level)', () => {
    const cmd = getRegistry().get('trip/flight');

    const FLIGHT_RAW = {
        airline: 'Norse Atlantic Airways',
        departureTime: '1:05 PM',
        departureAirport: 'LGW',
        arrivalTime: '3:55 PM',
        arrivalAirport: 'JFK',
        duration: '7h 50m',
        stops: 'Nonstop',
        price: 662,
        currency: 'USD',
    };

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects invalid IATA / date / from==to / limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { from: 'LO', to: 'NYC', date: '2026-08-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('IATA') });
        await expect(cmd.func(page, { from: 'LON', to: 'LON', date: '2026-08-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('must differ') });
        await expect(cmd.func(page, { from: 'LON', to: 'NYC', date: '08/15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--date') });
        await expect(cmd.func(page, { from: 'LON', to: 'NYC', date: '2026-08-15', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired when a verification gate is detected', async () => {
        const page = createPageMock(['captcha']);
        await expect(cmd.func(page, { from: 'LON', to: 'NYC', date: '2026-08-15', limit: 5 }))
            .rejects.toThrow('Trip.com is asking for a verification');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError on render timeout and on malformed extraction', async () => {
        await expect(cmd.func(createPageMock(['timeout']), { from: 'LON', to: 'NYC', date: '2026-08-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render flight cards') });
        await expect(cmd.func(createPageMock(['content', { rows: [] }]), { from: 'LON', to: 'NYC', date: '2026-08-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed rows') });
    });

    it('throws EmptyResultError when extraction returns no flights', async () => {
        await expect(cmd.func(createPageMock(['content', []]), { from: 'LON', to: 'NYC', date: '2026-08-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('maps DOM-extracted rows and respects --limit', async () => {
        const page = createPageMock(['content', [FLIGHT_RAW, { ...FLIGHT_RAW, airline: 'Jetblue Airways', price: 837 }]]);
        const rows = await cmd.func(page, { from: 'LON', to: 'NYC', date: '2026-08-15', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1,
            airline: 'Norse Atlantic Airways',
            departureTime: '1:05 PM',
            departureAirport: 'LGW',
            arrivalTime: '3:55 PM',
            arrivalAirport: 'JFK',
            price: 662,
            currency: 'USD',
        });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
    });
});

describe('trip buildFlightExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://www.trip.com/' });
        const js = buildFlightExtractJs();
        return Function('document', `return (${js})`)(dom.window.document);
    }

    const CARD = `
      <div class="result-item">
        <div data-testid="flights-name">Norse Atlantic Airways</div>
        <div class="font-black_x">LGW</div>
        <div class="font-black_x">JFK</div>
        <span>1:05</span><span>PM</span>
        <span>3:55</span><span>PM</span>
        <span>7h 50m</span>
        <div data-testid="stopInfoText">Nonstop</div>
        <div data-testid="flight_price_1-0">$662</div>
      </div>`;

    it('extracts a flight card via data-testid + time/code anchors', () => {
        expect(runExtract(CARD)).toEqual([{
            airline: 'Norse Atlantic Airways',
            departureTime: '1:05 PM',
            departureAirport: 'LGW',
            arrivalTime: '3:55 PM',
            arrivalAirport: 'JFK',
            duration: '7h 50m',
            stops: 'Nonstop',
            price: 662,
            currency: 'USD',
        }]);
    });

    it('keeps price null when the price node is missing/non-numeric', () => {
        const noPrice = CARD.replace('<div data-testid="flight_price_1-0">$662</div>', '<div data-testid="flight_price_1-0">--</div>');
        expect(runExtract(noPrice)[0].price).toBeNull();
    });

    it('drops cards missing airline or an airport (no sentinel rows)', () => {
        const noAirline = CARD.replace('<div data-testid="flights-name">Norse Atlantic Airways</div>', '');
        expect(runExtract(noAirline)).toEqual([]);
        expect(runExtract('<div class="result-item"></div>')).toEqual([]);
    });
});

describe('trip parseCityId', () => {
    it('accepts numeric city ids', () => {
        expect(parseCityId('city', '338')).toBe('338');
        expect(parseCityId('city', 338)).toBe('338');
    });
    it('rejects empty / non-numeric ids', () => {
        expect(() => parseCityId('city', '')).toThrow('required');
        expect(() => parseCityId('city', 'London')).toThrow('numeric');
    });
});

describe('trip buildHotelSearchUrl', () => {
    it('pins city / dates / English / USD params', () => {
        const url = buildHotelSearchUrl('338', '2026-08-15', '2026-08-16');
        const qs = new URL(url).searchParams;
        expect(url).toContain('https://www.trip.com/hotels/list?');
        expect(qs.get('city')).toBe('338');
        expect(qs.get('checkin')).toBe('2026-08-15');
        expect(qs.get('checkout')).toBe('2026-08-16');
        expect(qs.get('locale')).toBe('en_US');
        expect(qs.get('curr')).toBe('USD');
    });
});

describe('trip hotel-search command (registry-level)', () => {
    const cmd = getRegistry().get('trip/hotel-search');

    const HOTEL_RAW = {
        name: 'Royal National Hotel',
        score: 8.2,
        reviewLabel: 'Very good',
        reviews: 2918,
        location: 'Bloomsbury, Near The British Museum',
        room: 'Standard Plus Twin Room',
        price: 205,
        currency: 'USD',
    };

    it('declares Strategy.COOKIE + browser:true + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects invalid city / dates / limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { city: 'London', checkin: '2026-08-15', checkout: '2026-08-16', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('numeric') });
        await expect(cmd.func(page, { city: '338', checkin: '08/15', checkout: '2026-08-16', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--checkin') });
        await expect(cmd.func(page, { city: '338', checkin: '2026-08-16', checkout: '2026-08-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('before --checkout') });
        await expect(cmd.func(page, { city: '338', checkin: '2026-08-15', checkout: '2026-08-16', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired on verification, CommandExec on timeout, EmptyResult on no hotels', async () => {
        await expect(cmd.func(createPageMock(['captcha']), { city: '338', checkin: '2026-08-15', checkout: '2026-08-16', limit: 5 }))
            .rejects.toThrow('Trip.com is asking for a verification');
        await expect(cmd.func(createPageMock(['timeout']), { city: '338', checkin: '2026-08-15', checkout: '2026-08-16', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render hotel cards') });
        await expect(cmd.func(createPageMock(['content', []]), { city: '338', checkin: '2026-08-15', checkout: '2026-08-16', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('maps DOM-extracted rows and respects --limit', async () => {
        const page = createPageMock(['content', [HOTEL_RAW, { ...HOTEL_RAW, name: 'LSE Rosebery Hall', price: 116 }]]);
        const rows = await cmd.func(page, { city: '338', checkin: '2026-08-15', checkout: '2026-08-16', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, name: 'Royal National Hotel', score: 8.2, reviews: 2918, price: 205, currency: 'USD' });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
    });
});

describe('trip buildHotelExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://www.trip.com/' });
        const js = buildHotelExtractJs();
        return Function('document', `return (${js})`)(dom.window.document);
    }

    const CARD = `
      <div class="hotel-card">
        <div class="hotelName">Royal National Hotel</div>
        <div class="score">8.2</div>
        <div class="comment-desc">Very good</div>
        <div class="comment-num">2,918 reviews</div>
        <div class="position-desc">Bloomsbury</div>
        <div class="position-desc">Near The British Museum</div>
        <div class="room-name">Standard Plus Twin Room</div>
        <div class="price-highlight">$205</div>
      </div>`;

    it('extracts a hotel card with numeric score / reviews / price', () => {
        expect(runExtract(CARD)).toEqual([{
            name: 'Royal National Hotel',
            score: 8.2,
            reviewLabel: 'Very good',
            reviews: 2918,
            location: 'Bloomsbury, Near The British Museum',
            room: 'Standard Plus Twin Room',
            price: 205,
            currency: 'USD',
        }]);
    });

    it('keeps price null when non-numeric and drops cards without a name', () => {
        const noPrice = CARD.replace('<div class="price-highlight">$205</div>', '<div class="price-highlight">Sold out</div>');
        expect(runExtract(noPrice)[0].price).toBeNull();
        const noName = CARD.replace('<div class="hotelName">Royal National Hotel</div>', '');
        expect(runExtract(noName)).toEqual([]);
    });
});

const HOTEL_DETAIL_SSR = {
    hotelBaseInfo: {
        masterHotelId: 715233,
        cityName: 'London',
        nameInfo: { name: 'LSE Rosebery Hall', nameEn: '' },
        starInfo: { level: 2 },
    },
    hotelPositionInfo: { address: '90 Rosebery Ave, Islington, London, EC1R 4TY, United Kingdom', lat: '51.527561', lng: '-0.107065' },
    hotelComment: {
        comment: {
            score: '8.3',
            scoreDescription: 'Very good',
            totalComment: 159,
            scoreDetail: [
                { showName: 'Cleanliness', showScore: '8.7' },
                { showName: 'Amenities', showScore: '7.7' },
                { showName: 'Location', showScore: '8.5' },
                { showName: 'Service', showScore: '8.3' },
            ],
        },
    },
    hotelFacilityPopV2: {
        hotelPopularFacility: {
            list: [
                { facilityDesc: 'Luggage storage' },
                { facilityDesc: 'Wi-Fi in public areas' },
            ],
        },
    },
    hotelPolicyInfo: {
        checkInAndOut: {
            content: [
                { title: 'Check-in: ', description: 'After 15:00' },
                { title: 'Check-out: ', description: 'Before 10:30' },
                { description: 'Front desk hours: 24/7' },
            ],
        },
    },
};

// Shape as projected by buildHotelDetailExtractJs (what page.evaluate returns).
const HOTEL_DETAIL_ROW = {
    hotelId: '715233',
    name: 'LSE Rosebery Hall',
    enName: null,
    star: 2,
    score: 8.3,
    scoreLabel: 'Very good',
    reviewCount: 159,
    ratingBreakdown: 'Cleanliness 8.7 / Amenities 7.7 / Location 8.5 / Service 8.3',
    facilities: 'Luggage storage / Wi-Fi in public areas',
    checkInOut: 'Check-in: After 15:00 / Check-out: Before 10:30 / Front desk hours: 24/7',
    cityName: 'London',
    address: '90 Rosebery Ave, Islington, London, EC1R 4TY, United Kingdom',
    lat: 51.527561,
    lon: -0.107065,
};

describe('trip parseHotelId', () => {
    it('accepts a numeric id as string', () => {
        expect(parseHotelId('id', '715233')).toBe('715233');
    });
    it('rejects blank / non-numeric ids', () => {
        expect(() => parseHotelId('id', '')).toThrow('required');
        expect(() => parseHotelId('id', 'abc')).toThrow('numeric Trip.com hotel id');
    });
});

describe('trip buildHotelDetailUrl', () => {
    it('builds the detail URL with the hotel id', () => {
        const url = buildHotelDetailUrl('715233');
        expect(url.startsWith('https://www.trip.com/hotels/detail/?')).toBe(true);
        expect(url).toContain('hotelId=715233');
        expect(url).toContain('curr=USD');
    });
});

describe('trip hotel command (registry-level)', () => {
    const cmd = getRegistry().get('trip/hotel');

    it('declares Strategy.COOKIE + browser:true + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects a non-numeric id before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { id: 'shoreditch' }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('numeric Trip.com hotel id') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired on verification, CommandExec on timeout / malformed, EmptyResult on no profile', async () => {
        await expect(cmd.func(createPageMock(['captcha']), { id: '715233' }))
            .rejects.toThrow('Trip.com is asking for a verification');
        await expect(cmd.func(createPageMock(['timeout']), { id: '715233' }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not expose SSR hotel data') });
        await expect(cmd.func(createPageMock(['content', null]), { id: '715233' }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed data') });
        await expect(cmd.func(createPageMock(['content', { hotelId: null, name: null }]), { id: '715233' }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('maps the SSR profile into a single row carrying every declared column', async () => {
        const page = createPageMock(['content', HOTEL_DETAIL_ROW]);
        const rows = await cmd.func(page, { id: '715233' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            hotelId: '715233',
            name: 'LSE Rosebery Hall',
            star: 2,
            score: 8.3,
            ratingBreakdown: 'Cleanliness 8.7 / Amenities 7.7 / Location 8.5 / Service 8.3',
            facilities: 'Luggage storage / Wi-Fi in public areas',
            url: expect.stringContaining('hotelId=715233'),
        });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
    });
});

describe('trip buildHotelDetailExtractJs (JSDOM)', () => {
    function runExtract(nextData) {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', {
            url: 'https://www.trip.com/hotels/detail/',
            runScripts: 'outside-only',
        });
        dom.window.__NEXT_DATA__ = nextData;
        return dom.window.Function(`return (${buildHotelDetailExtractJs()})`)();
    }

    it('projects the hotel profile, joining sub-scores / amenities / policy', () => {
        const out = runExtract({ props: { pageProps: { hotelDetailResponse: HOTEL_DETAIL_SSR } } });
        expect(out).toEqual(HOTEL_DETAIL_ROW);
    });

    it('returns null when the SSR detail block is absent', () => {
        expect(runExtract({ props: { pageProps: {} } })).toBeNull();
    });

    it('detects the rendered SSR block as content via WAIT_FOR_HOTEL_DETAIL_JS', async () => {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', {
            url: 'https://www.trip.com/hotels/detail/',
            runScripts: 'outside-only',
        });
        dom.window.__NEXT_DATA__ = { props: { pageProps: { hotelDetailResponse: HOTEL_DETAIL_SSR } } };
        await expect(dom.window.Function(`return (${WAIT_FOR_HOTEL_DETAIL_JS})`)())
            .resolves.toBe('content');
    });
});

describe('trip buildFlightRoundSearchUrl', () => {
    it('lowercases codes and pins round-trip English/USD params', () => {
        const url = buildFlightRoundSearchUrl('LON', 'NYC', '2026-08-15', '2026-08-22');
        const qs = new URL(url).searchParams;
        expect(url).toContain('https://www.trip.com/flights/showfarefirst?');
        expect(qs.get('dcity')).toBe('lon');
        expect(qs.get('acity')).toBe('nyc');
        expect(qs.get('ddate')).toBe('2026-08-15');
        expect(qs.get('rdate')).toBe('2026-08-22');
        expect(qs.get('triptype')).toBe('rt');
        expect(qs.get('curr')).toBe('USD');
    });
});

describe('trip flight-round command (registry-level)', () => {
    const cmd = getRegistry().get('trip/flight-round');

    const FLIGHT_RAW = {
        airline: 'British Airways',
        departureTime: '6:05 PM',
        departureAirport: 'LHR',
        arrivalTime: '9:05 PM',
        arrivalAirport: 'JFK',
        duration: '8h',
        stops: 'Nonstop',
        price: 758,
        currency: 'USD',
    };

    it('declares Strategy.COOKIE + browser:true + navigateBefore:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects invalid IATA / dates / from==to / depart>=return / limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { from: 'LO', to: 'NYC', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('IATA') });
        await expect(cmd.func(page, { from: 'LON', to: 'LON', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('must differ') });
        await expect(cmd.func(page, { from: 'LON', to: 'NYC', depart: '08/15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--depart') });
        await expect(cmd.func(page, { from: 'LON', to: 'NYC', depart: '2026-08-22', return: '2026-08-15', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--depart must be before --return') });
        await expect(cmd.func(page, { from: 'LON', to: 'NYC', depart: '2026-08-15', return: '2026-08-22', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired on verification, CommandExec on timeout, EmptyResult on no flights', async () => {
        await expect(cmd.func(createPageMock(['captcha']), { from: 'LON', to: 'NYC', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toThrow('Trip.com is asking for a verification');
        await expect(cmd.func(createPageMock(['timeout']), { from: 'LON', to: 'NYC', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render flight cards') });
        await expect(cmd.func(createPageMock(['content', []]), { from: 'LON', to: 'NYC', depart: '2026-08-15', return: '2026-08-22', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('maps DOM-extracted rows against the round-trip URL and respects --limit', async () => {
        const page = createPageMock(['content', [FLIGHT_RAW, { ...FLIGHT_RAW, airline: 'American Airlines', price: 767 }]]);
        const rows = await cmd.func(page, { from: 'LON', to: 'NYC', depart: '2026-08-15', return: '2026-08-22', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, airline: 'British Airways', departureAirport: 'LHR', price: 758, currency: 'USD' });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('triptype=rt');
    });
});

const ATTR_CARD = `
  <div>
    <a href="https://www.trip.com/things-to-do/detail/24465457/">Tokyo Metro 24/48/72 Hour Pass</a>
    <span>4.8 /5</span> <span>4.9k reviews</span> <span>109.5k booked</span>
    <span>Up to $3 off</span> <span>$5.54</span> <span>$6.16</span>
  </div>`;

const ATTR_RAW = {
    name: 'Tokyo Metro 24/48/72 Hour Pass',
    rating: 4.8,
    reviews: 4900,
    booked: 109500,
    price: 5.54,
    url: 'https://www.trip.com/things-to-do/detail/24465457/',
};

describe('trip parseKeyword', () => {
    it('accepts a non-empty keyword', () => {
        expect(parseKeyword('query', 'Tokyo')).toBe('Tokyo');
        expect(parseKeyword('query', '  Paris  ')).toBe('Paris');
    });
    it('rejects blank / over-long keywords', () => {
        expect(() => parseKeyword('query', '')).toThrow('required');
        expect(() => parseKeyword('query', 'x'.repeat(61))).toThrow('too long');
    });
});

describe('trip buildAttractionSearchUrl', () => {
    it('builds the things-to-do search URL with the keyword', () => {
        const url = buildAttractionSearchUrl('Tokyo');
        expect(url.startsWith('https://www.trip.com/things-to-do/list?')).toBe(true);
        expect(url).toContain('keyword=Tokyo');
        expect(url).toContain('curr=USD');
    });
});

describe('trip attraction command (registry-level)', () => {
    const cmd = getRegistry().get('trip/attraction');

    it('declares Strategy.COOKIE + browser:true + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects a blank query and invalid limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { query: '', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { query: 'Tokyo', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired on verification, EmptyResult on empty, CommandExec on timeout / drift', async () => {
        await expect(cmd.func(createPageMock(['captcha']), { query: 'Tokyo', limit: 5 }))
            .rejects.toThrow('Trip.com is asking for a verification');
        await expect(cmd.func(createPageMock(['empty']), { query: 'Nowherexyz', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(cmd.func(createPageMock(['timeout']), { query: 'Tokyo', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render product cards') });
        await expect(cmd.func(createPageMock(['content', []]), { query: 'Tokyo', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not find required detail-link anchors') });
    });

    it('maps rows with a per-row detail url and respects --limit', async () => {
        const page = createPageMock(['content', [ATTR_RAW, { ...ATTR_RAW, name: 'Mount Fuji Day Trip', price: 36.29 }]]);
        const rows = await cmd.func(page, { query: 'Tokyo', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, name: 'Tokyo Metro 24/48/72 Hour Pass', rating: 4.8, reviews: 4900, price: 5.54, currency: 'USD', url: ATTR_RAW.url });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('keyword=Tokyo');
    });
});

describe('trip buildAttractionExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://www.trip.com/things-to-do/list' });
        return Function('document', `return (${buildAttractionExtractJs()})`)(dom.window.document);
    }

    it('extracts a product by its stable detail link, excluding the promo price', () => {
        expect(runExtract(ATTR_CARD)).toEqual([ATTR_RAW]);
    });

    it('dedupes repeated detail links and drops links without a numeric id', () => {
        expect(runExtract(ATTR_CARD + ATTR_CARD)).toHaveLength(1);
        expect(runExtract('<div><a href="/things-to-do/detail/none/">No id</a><span>$5</span></div>')).toEqual([]);
    });
});

const TRAIN_TABLE = `
  <table>
    <tr><th class="item item-departure">Departure</th><th class="item item-arrival">Arrival</th></tr>
    <tr>
      <td class="item item-departure"><span class="item-time-text">05:27</span>3h 38m, 1 change<span class="item-name">London St. Pancras International</span></td>
      <td class="item item-arrival"><span class="item-time-text">09:05</span><span class="item-name">Manchester Piccadilly</span></td>
    </tr>
    <tr>
      <td class="item item-departure"><span class="item-time-text">06:08</span>2h 17m, Direct<span class="item-name">London Euston</span></td>
      <td class="item item-arrival"><span class="item-time-text">08:25</span><span class="item-name">Manchester Piccadilly</span></td>
    </tr>
  </table>`;

const TRAIN_RAW = {
    departureTime: '05:27',
    fromStation: 'London St. Pancras International',
    arrivalTime: '09:05',
    toStation: 'Manchester Piccadilly',
    duration: '3h 38m',
    changes: 1,
};

describe('trip buildTrainRouteUrl', () => {
    it('slugifies the cities under the country route path', () => {
        expect(buildTrainRouteUrl('uk', 'London', 'Manchester'))
            .toBe('https://www.trip.com/trains/uk/route/london-to-manchester/');
        expect(buildTrainRouteUrl('France', 'Paris', 'Lyon'))
            .toBe('https://www.trip.com/trains/france/route/paris-to-lyon/');
    });
});

describe('trip train command (registry-level)', () => {
    const cmd = getRegistry().get('trip/train');

    it('declares Strategy.COOKIE + browser:true + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects a blank city / country and invalid limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { from: '', to: 'Manchester', country: 'uk', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { from: 'London', to: 'Manchester', country: '', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { from: 'London', to: 'Manchester', country: 'uk', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired on verification, CommandExec on timeout, EmptyResult on no timetable', async () => {
        await expect(cmd.func(createPageMock(['captcha']), { from: 'London', to: 'Manchester', country: 'uk', limit: 5 }))
            .rejects.toThrow('Trip.com is asking for a verification');
        await expect(cmd.func(createPageMock(['timeout']), { from: 'London', to: 'Manchester', country: 'uk', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render') });
        await expect(cmd.func(createPageMock(['content', []]), { from: 'London', to: 'Manchester', country: 'uk', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('maps timetable rows against the route URL and respects --limit', async () => {
        const page = createPageMock(['content', [TRAIN_RAW, { ...TRAIN_RAW, departureTime: '06:08', changes: 0 }]]);
        const rows = await cmd.func(page, { from: 'London', to: 'Manchester', country: 'uk', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, departureTime: '05:27', fromStation: 'London St. Pancras International', arrivalTime: '09:05', duration: '3h 38m', changes: 1 });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('/trains/uk/route/london-to-manchester/');
    });
});

describe('trip buildTrainExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://www.trip.com/trains/uk/route/london-to-manchester/' });
        return Function('document', `return (${buildTrainExtractJs()})`)(dom.window.document);
    }

    it('extracts timetable journeys, parsing duration and change count', () => {
        const rows = runExtract(TRAIN_TABLE);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual(TRAIN_RAW);
        expect(rows[1].changes).toBe(0);
        expect(rows[1].fromStation).toBe('London Euston');
    });

    it('drops the header row and rows missing a time or station', () => {
        expect(runExtract('<table><tr><th class="item item-departure">Departure</th><th class="item item-arrival">Arrival</th></tr></table>')).toEqual([]);
    });
});

const CAR_CARDS = `
  <div class="card-item">
    <div class="card-item-title"><span>Mid-sized car</span><div class="title-info">Toyota Camry or Similar</div></div>
    <div class="card-item-vehicle-info"><span>5</span> <span>3</span> <span>4</span></div>
    <div class="card-item-price"><div class="card-item-price__main"><span class="car-daily-price">From $50 /day</span></div></div>
  </div>
  <div class="card-item">
    <div class="card-item-title"><span>Compact car</span><div class="title-info">Toyota Corolla or Similar</div></div>
    <div class="card-item-vehicle-info"><span>5</span> <span>3</span> <span>4</span></div>
    <div class="card-item-price"><div class="card-item-price__main"><span class="car-daily-price">From $47 /day</span></div></div>
  </div>`;

const CAR_RAW = {
    category: 'Mid-sized car',
    vehicle: 'Toyota Camry or Similar',
    seats: 5,
    price: 50,
    currency: 'USD',
};

describe('trip buildCarListUrl', () => {
    it('routes by the numeric city id with cosmetic slugs', () => {
        expect(buildCarListUrl('313')).toBe('https://www.trip.com/carhire/to-city-1/city-313/');
    });
});

describe('trip car command (registry-level)', () => {
    const cmd = getRegistry().get('trip/car');

    it('declares Strategy.COOKIE + browser:true + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects a non-numeric city and invalid limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { city: 'san francisco', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('numeric') });
        await expect(cmd.func(page, { city: '313', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired on verification, EmptyResult on an empty listing, CommandExec on timeout or drift', async () => {
        await expect(cmd.func(createPageMock(['captcha']), { city: '313', limit: 5 }))
            .rejects.toThrow('Trip.com is asking for a verification');
        await expect(cmd.func(createPageMock(['empty']), { city: '313', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(cmd.func(createPageMock(['timeout']), { city: '313', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render') });
        await expect(cmd.func(createPageMock(['content', []]), { city: '313', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not find') });
    });

    it('maps vehicle rows against the listing URL and respects --limit', async () => {
        const page = createPageMock(['content', [CAR_RAW, { ...CAR_RAW, category: 'Compact car', price: 47 }]]);
        const rows = await cmd.func(page, { city: '313', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, category: 'Mid-sized car', vehicle: 'Toyota Camry or Similar', seats: 5, price: 50, currency: 'USD' });
        expect(rows[0].url).toBe('https://www.trip.com/carhire/to-city-1/city-313/');
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
    });
});

describe('trip buildCarExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://www.trip.com/carhire/to-city-1/city-313/' });
        return Function('document', `return (${buildCarExtractJs()})`)(dom.window.document);
    }

    it('splits the category from the example model and reads seats + price', () => {
        const rows = runExtract(CAR_CARDS);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual(CAR_RAW);
        expect(rows[1]).toMatchObject({ category: 'Compact car', vehicle: 'Toyota Corolla or Similar', price: 47 });
    });

    it('drops cards without a rendered price', () => {
        expect(runExtract('<div class="card-item"><div class="card-item-title"><div class="title-info">No Price Car</div></div></div>')).toEqual([]);
    });
});

describe('trip WAIT_FOR_CARS_JS (JSDOM)', () => {
    it('detects a rendered price anchor as content', async () => {
        const dom = new JSDOM('<!doctype html><html><body><div class="card-item"><span class="car-daily-price">From $50 /day</span></div></body></html>', {
            url: 'https://www.trip.com/carhire/to-city-1/city-313/',
            runScripts: 'outside-only',
        });
        await expect(dom.window.Function(`return (${WAIT_FOR_CARS_JS})`)())
            .resolves.toBe('content');
    });
});

const TRANSFER_CARDS = `
  <div class="vehicle-booking-list">
    <div class="vehicle-card">
      <div class="vehicle-card__title"><span class="vehicle-card__title-text">Standard Car</span></div>
      <span class="vehicle-card__capacity-text">Max 4</span>
      <span class="vehicle-card__luggage-text">1</span>
      <div class="vehicle-card__price-block"><span class="vehicle-card__discount-tag">$ 4.21 off</span><div class="vehicle-card__price-row">From $15.73 Incl. taxes &amp; fees</div></div>
    </div>
    <div class="vehicle-card">
      <div class="vehicle-card__title"><span class="vehicle-card__title-text">Minibus</span></div>
      <span class="vehicle-card__capacity-text">Max 9</span>
      <span class="vehicle-card__luggage-text">3</span>
      <div class="vehicle-card__price-block"><div class="vehicle-card__price-row">From $30.81 Incl. taxes &amp; fees</div></div>
    </div>
  </div>`;

const TRANSFER_RAW = {
    type: 'Standard Car',
    passengers: 4,
    luggage: 1,
    price: 15.73,
    currency: 'USD',
};

describe('trip buildTransferListUrl', () => {
    it('slugifies the city and airport code into the SEO path', () => {
        expect(buildTransferListUrl('Bangkok', 'DMK'))
            .toBe('https://www.trip.com/airport-transfers/bangkok/airport-dmk/');
        expect(buildTransferListUrl('Ho Chi Minh City', 'SGN'))
            .toBe('https://www.trip.com/airport-transfers/ho-chi-minh-city/airport-sgn/');
    });
});

describe('trip transfer command (registry-level)', () => {
    const cmd = getRegistry().get('trip/transfer');

    it('declares Strategy.COOKIE + browser:true + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects a blank city / non-IATA airport and invalid limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { city: '', airport: 'DMK', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { city: 'Bangkok', airport: 'BANGKOK', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('IATA') });
        await expect(cmd.func(page, { city: 'Bangkok', airport: 'DMK', limit: 99 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired on verification, EmptyResult on no listing, CommandExec on timeout', async () => {
        await expect(cmd.func(createPageMock(['captcha']), { city: 'Bangkok', airport: 'DMK', limit: 5 }))
            .rejects.toThrow('Trip.com is asking for a verification');
        await expect(cmd.func(createPageMock(['empty']), { city: 'Bangkok', airport: 'DMK', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(cmd.func(createPageMock(['timeout']), { city: 'Bangkok', airport: 'DMK', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render') });
    });

    it('flags a landing-page bounce when the city does not match the airport', async () => {
        await expect(cmd.func(createPageMock(['content', '/airport-transfers/']), { city: 'Paris', airport: 'DMK', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('bounced') });
    });

    it('maps vehicle rows against the listing URL and respects --limit', async () => {
        const page = createPageMock(['content', '/airport-transfers/bangkok/airport-dmk/', [TRANSFER_RAW, { ...TRANSFER_RAW, type: 'Minibus', passengers: 9, price: 30.81 }]]);
        const rows = await cmd.func(page, { city: 'Bangkok', airport: 'DMK', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, type: 'Standard Car', passengers: 4, luggage: 1, price: 15.73, currency: 'USD' });
        expect(rows[0].url).toBe('https://www.trip.com/airport-transfers/bangkok/airport-dmk/');
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
    });
});

describe('trip buildTransferExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://www.trip.com/airport-transfers/bangkok/airport-dmk/' });
        return Function('document', `return (${buildTransferExtractJs()})`)(dom.window.document);
    }

    it('reads type / passengers / luggage / price and excludes the discount tag', () => {
        const rows = runExtract(TRANSFER_CARDS);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual(TRANSFER_RAW);
        expect(rows[1]).toMatchObject({ type: 'Minibus', passengers: 9, luggage: 3, price: 30.81 });
    });

    it('drops cards without a type or price', () => {
        expect(runExtract('<div class="vehicle-card"><div class="vehicle-card__price-row">From $15 Incl.</div></div>')).toEqual([]);
    });
});

describe('trip WAIT_FOR_TRANSFERS_JS (JSDOM)', () => {
    it('detects a rendered price row as content', async () => {
        const dom = new JSDOM('<!doctype html><html><body><div class="vehicle-card"><div class="vehicle-card__price-row">From $15.73</div></div></body></html>', {
            url: 'https://www.trip.com/airport-transfers/bangkok/airport-dmk/',
            runScripts: 'outside-only',
        });
        await expect(dom.window.Function(`return (${WAIT_FOR_TRANSFERS_JS})`)())
            .resolves.toBe('content');
    });
});

const TOUR_RAW = {
    name: '2D1N · Private Tours · Japan Osaka + Kyoto + Nara Kansai Three-City Travel Route',
    type: 'Private Tours',
    rating: 4.9,
    reviews: 48,
    price: 88,
    url: 'https://us.trip.com/package-tours/detail/70457661?city=219&locale=en-US&curr=USD',
};

describe('trip buildTourSearchUrl', () => {
    it('builds the package-tours list URL with kwd + tabType', () => {
        expect(buildTourSearchUrl('Kyoto', 'privateTours'))
            .toBe('https://www.trip.com/package-tours/list?kwd=Kyoto&tabType=privateTours&locale=en-US&curr=USD');
    });
});

describe('trip buildTourSearchJs', () => {
    it('embeds the keyword, the products-content capture guard, and the empty-result guard', () => {
        const js = buildTourSearchJs('Bali');
        expect(js).toContain('"Bali"');
        expect(js).toContain('"products":[');
        expect(js).toContain('routes?');
    });
});

describe('trip tour command (registry-level)', () => {
    const cmd = getRegistry().get('trip/tour');

    it('declares Strategy.COOKIE + browser:true + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects a blank query, invalid --type, and invalid limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { query: '', type: 'private', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func(page, { query: 'Kyoto', type: 'luxury', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--type') });
        await expect(cmd.func(page, { query: 'Kyoto', type: 'private', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired on verification, EmptyResult on a genuine no-match, CommandExec on timeout / malformed / drift', async () => {
        await expect(cmd.func(createPageMock([{ status: 'captcha' }]), { query: 'Kyoto', type: 'private', limit: 5 }))
            .rejects.toThrow('Trip.com is asking for a verification');
        await expect(cmd.func(createPageMock([{ status: 'empty' }]), { query: 'Nowherexyz', type: 'private', limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        await expect(cmd.func(createPageMock([{ status: 'timeout' }]), { query: 'Kyoto', type: 'private', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not return results') });
        await expect(cmd.func(createPageMock([null]), { query: 'Kyoto', type: 'private', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed') });
        await expect(cmd.func(createPageMock([{ status: 'content', rows: [] }]), { query: 'Kyoto', type: 'private', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('none carried a name') });
    });

    it('maps captured products, drops nameless rows, and respects --type / --limit', async () => {
        const page = createPageMock([{ status: 'content', rows: [TOUR_RAW, { name: null }, { ...TOUR_RAW, name: 'Osaka Group Tour', price: 119 }] }]);
        const rows = await cmd.func(page, { query: 'Kyoto', type: 'group', limit: 5 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ rank: 1, name: TOUR_RAW.name, type: 'Private Tours', rating: 4.9, reviews: 48, price: 88, currency: 'USD', url: TOUR_RAW.url });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('tabType=groupTours');
    });
});

const POI_CITY = {
    name: 'Bali',
    cityId: 723,
    provinceName: 'Bali Province',
    countryName: 'Indonesia',
    airportCode: '',
    childResults: [
        { name: 'Ngurah Rai International Airport', cityId: 723, airportCode: 'DPS', provinceName: 'Bali Province', countryName: 'Indonesia' },
    ],
};

function poiResponse(payload) {
    return new Response(JSON.stringify(payload), { status: 200 });
}

describe('trip mapSearchRow', () => {
    it('classifies a city vs an airport and preserves ids (no silent drop)', () => {
        expect(mapSearchRow(POI_CITY, 0)).toEqual({
            rank: 1, name: 'Bali', type: 'city', cityId: 723, airportCode: null,
            province: 'Bali Province', country: 'Indonesia',
        });
        expect(mapSearchRow(POI_CITY.childResults[0], 1)).toMatchObject({
            rank: 2, name: 'Ngurah Rai International Airport', type: 'airport', cityId: 723, airportCode: 'DPS',
        });
    });
    it('keeps cityId null when the entry has none (e.g. a province)', () => {
        expect(mapSearchRow({ name: 'Bali Province', provinceName: 'Bali Province', countryName: 'Indonesia' }, 0).cityId).toBeNull();
    });
});

describe('trip flattenPoiResults', () => {
    it('flattens each city plus its child airports in order', () => {
        const rows = flattenPoiResults([POI_CITY]);
        expect(rows).toHaveLength(2);
        expect(rows[0].name).toBe('Bali');
        expect(rows[1].airportCode).toBe('DPS');
    });
    it('skips non-object entries', () => {
        expect(flattenPoiResults([null, POI_CITY, 'x'])).toHaveLength(2);
    });
});

describe('trip search command (registry-level)', () => {
    const cmd = getRegistry().get('trip/search');
    beforeEach(() => vi.unstubAllGlobals());

    it('declares Strategy.PUBLIC + browser:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(false);
        expect(String(cmd.strategy)).toContain('public');
    });

    it('rejects a blank query and invalid limit', async () => {
        await expect(cmd.func({ query: '', limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func({ query: 'Bali', limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
    });

    it('maps flattened suggestions and respects --limit', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(poiResponse({ results: [POI_CITY] }))));
        const rows = await cmd.func({ query: 'Bali', limit: 5 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ rank: 1, name: 'Bali', type: 'city', cityId: 723 });
        expect(rows[1]).toMatchObject({ rank: 2, type: 'airport', airportCode: 'DPS' });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
    });

    it('throws EmptyResult when the endpoint returns no results', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(poiResponse({ results: [] }))));
        await expect(cmd.func({ query: 'Nowherexyz', limit: 5 })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('surfaces HTTP + network failures as typed COMMAND_EXEC', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 503 }))));
        await expect(cmd.func({ query: 'Bali', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('status 503') });
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('socket hang up'))));
        await expect(cmd.func({ query: 'Bali', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('socket hang up') });
    });

    it('surfaces a 200 with an unparseable body as typed COMMAND_EXEC', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>not json</html>', { status: 200 }))));
        await expect(cmd.func({ query: 'Bali', limit: 5 })).rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('invalid JSON') });
    });

    it('surfaces a 200 POI body missing the results array as typed COMMAND_EXEC', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(poiResponse({ data: [] }))));
        await expect(cmd.func({ query: 'Bali', limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('missing results array') });
    });
});

const PKG_GROUP = {
    flightlist: [{
        binfo: { flightno: 'TW247', airlineName: "T'Way Air" },
        dportinfo: { aport: 'ICN' },
        aportinfo: { aport: 'NRT' },
        dateinfo: { dtime: '2026-08-05 18:15:00', atime: '2026-08-05 20:45:00' },
    }],
    policylist: [{ price: { price: 53.4 } }],
};

const PKG_ROW = {
    rank: 1,
    airline: "T'Way Air",
    flightNo: 'TW247',
    from: 'ICN',
    to: 'NRT',
    departure: '2026-08-05 18:15:00',
    arrival: '2026-08-05 20:45:00',
    stops: 0,
    price: 53.4,
    currency: 'USD',
};

const PKG_POIS = {
    Seoul: [{ name: 'Seoul', cityId: 274, cityCode: 'SEL', airportCode: '' }],
    Tokyo: [{ name: 'Tokyo', cityId: 228, cityCode: 'TYO', airportCode: '' }],
};

function stubPackageFetch({ pois = PKG_POIS, pkg = { grouplist: [PKG_GROUP] }, pkgStatus = 200 } = {}) {
    vi.stubGlobal('fetch', vi.fn((url, opts) => {
        if (String(url).includes('poiSearch')) {
            const key = JSON.parse(opts.body).key;
            return Promise.resolve(new Response(JSON.stringify({ results: pois[key] || [] }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify(pkg), { status: pkgStatus }));
    }));
}

describe('trip mapPackageRow', () => {
    it('projects a nonstop group into the route summary row', () => {
        expect(mapPackageRow(PKG_GROUP, 0)).toEqual(PKG_ROW);
    });
    it('reads the arrival off the last leg, counts stops, and keeps a missing price null', () => {
        const connection = {
            flightlist: [
                { binfo: { flightno: 'KE1', airlineName: 'Korean Air' }, dportinfo: { aport: 'ICN' }, aportinfo: { aport: 'PVG' }, dateinfo: { dtime: '2026-08-05 08:00:00', atime: '2026-08-05 10:00:00' } },
                { binfo: { flightno: 'KE2', airlineName: 'Korean Air' }, dportinfo: { aport: 'PVG' }, aportinfo: { aport: 'NRT' }, dateinfo: { dtime: '2026-08-05 12:00:00', atime: '2026-08-05 15:00:00' } },
            ],
            policylist: [],
        };
        expect(mapPackageRow(connection, 1)).toMatchObject({
            rank: 2, airline: 'Korean Air', flightNo: 'KE1', from: 'ICN', to: 'NRT',
            departure: '2026-08-05 08:00:00', arrival: '2026-08-05 15:00:00', stops: 1, price: null,
        });
    });
});

describe('trip resolvePackageCity', () => {
    beforeEach(() => vi.unstubAllGlobals());

    it('resolves the first city carrying both a metro code and id', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ results: [{ name: 'Tokyo', cityId: 228, cityCode: 'tyo', airportCode: '' }] }), { status: 200 }))));
        await expect(resolvePackageCity('Tokyo')).resolves.toEqual({ name: 'Tokyo', cityCode: 'TYO', cityId: 228 });
    });

    it('skips airport-only children and returns null when no city has a code', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ results: [
            { name: 'Narita International Airport', cityId: 228, cityCode: 'TYO', airportCode: 'NRT' },
            { name: 'Some Province', cityId: 0, cityCode: '' },
        ] }), { status: 200 }))));
        await expect(resolvePackageCity('nowhere')).resolves.toBeNull();
    });
});

describe('trip package command (registry-level)', () => {
    const cmd = getRegistry().get('trip/package');
    beforeEach(() => vi.unstubAllGlobals());

    it('declares Strategy.PUBLIC + browser:false + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(false);
        expect(String(cmd.strategy)).toContain('public');
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects a blank keyword, malformed dates, depart>=return, and invalid adults / limit', async () => {
        await expect(cmd.func({ from: '', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('required') });
        await expect(cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '08/05', return: '2026-08-08', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--depart') });
        await expect(cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-08', return: '2026-08-05', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--depart must be before --return') });
        await expect(cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 0, limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--adults') });
        await expect(cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
    });

    it('rejects an unresolvable keyword and a from==to that resolves to one city', async () => {
        stubPackageFetch({ pois: { Tokyo: PKG_POIS.Tokyo } });
        await expect(cmd.func({ from: 'Nowherexyz', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('Could not resolve origin') });
        await expect(cmd.func({ from: 'Tokyo', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('must differ') });
    });

    it('resolves both endpoints, maps package rows, and respects --limit', async () => {
        stubPackageFetch({ pkg: { grouplist: [PKG_GROUP, { ...PKG_GROUP, policylist: [{ price: { price: 61 } }] }] } });
        const rows = await cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(PKG_ROW);
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
    });

    it('throws EmptyResult when the endpoint returns no package groups', async () => {
        stubPackageFetch({ pkg: { grouplist: [] } });
        await expect(cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('throws CommandExec (drift) when groups return but none carry an itinerary', async () => {
        stubPackageFetch({ pkg: { grouplist: [{ policylist: [{ price: { price: 53.4 } }] }] } });
        await expect(cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('parseable flight identity') });
    });

    it('throws CommandExec (drift) when package legs lack flight identity, route, or times', async () => {
        stubPackageFetch({ pkg: { grouplist: [{ flightlist: [{}], policylist: [{ price: { price: 53.4 } }] }] } });
        await expect(cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('parseable flight identity') });
    });

    it('drops malformed package groups and reranks parseable rows', async () => {
        stubPackageFetch({ pkg: { grouplist: [{ flightlist: [{}] }, { ...PKG_GROUP, policylist: [] }] } });
        const rows = await cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 5 });
        expect(rows).toEqual([{ ...PKG_ROW, rank: 1, price: null }]);
    });

    it('surfaces a package endpoint failure as typed COMMAND_EXEC', async () => {
        stubPackageFetch({ pkgStatus: 503 });
        await expect(cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('status 503') });
    });

    it('surfaces a 200 package body that will not parse as typed COMMAND_EXEC', async () => {
        vi.stubGlobal('fetch', vi.fn((url, opts) => {
            if (String(url).includes('poiSearch')) {
                const key = JSON.parse(opts.body).key;
                return Promise.resolve(new Response(JSON.stringify({ results: PKG_POIS[key] || [] }), { status: 200 }));
            }
            return Promise.resolve(new Response('<html>not json</html>', { status: 200 }));
        }));
        await expect(cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('invalid JSON') });
    });

    it('surfaces a 200 package body missing grouplist as typed COMMAND_EXEC', async () => {
        stubPackageFetch({ pkg: { data: [] } });
        await expect(cmd.func({ from: 'Seoul', to: 'Tokyo', depart: '2026-08-05', return: '2026-08-08', adults: 2, limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('missing grouplist array') });
    });
});

const DEALS_HTML = `
  <div class="top-deals_root">
    <a class="top-deals_link-item" href="https://us.trip.com/sale/w/37676/gojapan.html">
      <img class="top-deals_item-img" />
      <div class="top-deals_item-text">
        <div class="top-deals_item-tit">Go Japan</div>
        <div class="top-deals_item-desc">Hotel up to 50% off</div>
      </div>
    </a>
    <a class="top-deals_link-item" href="https://us.trip.com/sale/w/19280/gochina.html">
      <div class="top-deals_item-text">
        <div class="top-deals_item-tit">Go China</div>
        <div class="top-deals_item-desc">Exclusive Summer Deals</div>
      </div>
    </a>
  </div>`;

const DEALS_RAW = {
    title: 'Go Japan',
    offer: 'Hotel up to 50% off',
    discount: '50%',
    url: 'https://us.trip.com/sale/w/37676/gojapan.html',
};

describe('trip buildDealsUrl', () => {
    it('pins the Top Deals hub URL with English / USD', () => {
        const url = buildDealsUrl();
        expect(url.startsWith('https://www.trip.com/sale/deals/?')).toBe(true);
        expect(url).toContain('locale=en-US');
        expect(url).toContain('curr=USD');
    });
});

describe('trip deals command (registry-level)', () => {
    const cmd = getRegistry().get('trip/deals');

    it('declares Strategy.COOKIE + browser:true + access:read', () => {
        expect(cmd.access).toBe('read');
        expect(cmd.browser).toBe(true);
        expect(String(cmd.strategy)).toContain('cookie');
        expect(cmd.domain).toBe('trip.com');
    });

    it('rejects an invalid limit before navigation', async () => {
        const page = createPageMock([]);
        await expect(cmd.func(page, { limit: 0 }))
            .rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining('--limit') });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequired on verification, CommandExec on timeout / malformed / no parsed tiles', async () => {
        await expect(cmd.func(createPageMock(['captcha']), { limit: 5 }))
            .rejects.toThrow('Trip.com is asking for a verification');
        await expect(cmd.func(createPageMock(['timeout']), { limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('did not render deal tiles') });
        await expect(cmd.func(createPageMock(['content', null]), { limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed rows') });
        // The hub is never legitimately empty, so rendered-but-nothing-parsed is drift, not empty.
        await expect(cmd.func(createPageMock(['content', []]), { limit: 5 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('no promotion tiles parsed') });
    });

    it('maps deal rows against the hub URL and respects --limit', async () => {
        const page = createPageMock(['content', [DEALS_RAW, { ...DEALS_RAW, title: 'Go China', offer: 'Exclusive Summer Deals', discount: null }]]);
        const rows = await cmd.func(page, { limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ rank: 1, title: 'Go Japan', offer: 'Hotel up to 50% off', discount: '50%', url: DEALS_RAW.url });
        for (const row of rows) {
            for (const col of cmd.columns) expect(row).toHaveProperty(col);
        }
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.goto.mock.calls[0][0]).toContain('/sale/deals/');
    });
});

describe('trip buildDealsExtractJs (JSDOM)', () => {
    function runExtract(html) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://www.trip.com/sale/deals/' });
        return Function('document', `return (${buildDealsExtractJs()})`)(dom.window.document);
    }

    it('extracts tiles with title / offer / parsed discount and dedupes by campaign URL', () => {
        const rows = runExtract(DEALS_HTML + DEALS_HTML);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual(DEALS_RAW);
        expect(rows[1]).toMatchObject({ title: 'Go China', offer: 'Exclusive Summer Deals', discount: null });
    });

    it('parses a $N off discount and prefixes a relative campaign href', () => {
        const rows = runExtract('<a class="top-deals_link-item" href="/sale/w/9/z.html"><div class="top-deals_item-tit">Flights</div><div class="top-deals_item-desc">Get $15 off</div></a>');
        expect(rows[0]).toMatchObject({ discount: '$15 off', url: 'https://www.trip.com/sale/w/9/z.html' });
    });

    it('drops tiles without a title or offer', () => {
        expect(runExtract('<a class="top-deals_link-item" href="/sale/w/1/x.html"></a>')).toEqual([]);
    });
});

describe('trip WAIT_FOR_DEALS_JS (JSDOM)', () => {
    it('detects a rendered deal tile as content', async () => {
        const dom = new JSDOM('<!doctype html><html><body><a class="top-deals_link-item" href="/sale/w/1/x.html"></a></body></html>', {
            url: 'https://www.trip.com/sale/deals/',
            runScripts: 'outside-only',
        });
        await expect(dom.window.Function(`return (${WAIT_FOR_DEALS_JS})`)())
            .resolves.toBe('content');
    });
});
