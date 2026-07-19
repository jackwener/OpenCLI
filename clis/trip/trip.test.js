import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import './flight.js';
import './hotel-search.js';
import {
    buildFlightExtractJs,
    buildFlightSearchUrl,
    buildHotelExtractJs,
    buildHotelSearchUrl,
    parseCityId,
    parseFlightLimit,
    parseIataCode,
    parseIsoDate,
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

describe('trip parseFlightLimit', () => {
    it('falls back for empty / undefined', () => {
        expect(parseFlightLimit(undefined)).toBe(20);
        expect(parseFlightLimit('')).toBe(20);
        expect(parseFlightLimit(undefined, 5)).toBe(5);
    });
    it('rejects out-of-range / non-integer (no silent clamp)', () => {
        expect(() => parseFlightLimit(0)).toThrow('--limit');
        expect(() => parseFlightLimit(51)).toThrow('--limit');
        expect(() => parseFlightLimit('abc')).toThrow('--limit');
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
