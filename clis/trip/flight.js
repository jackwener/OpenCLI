/**
 * Trip.com (international) one-way flight search by IATA route + date.
 *
 * Trip.com is the English-facing sibling of Ctrip. Results render client-side
 * into `.result-item` cards keyed by stable `data-testid` anchors, so this
 * reads by selector (see `buildFlightExtractJs` in utils) rather than by
 * position. Rows missing the airline, both airports, or both times are dropped.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_FLIGHTS_JS,
    buildFlightExtractJs,
    buildFlightSearchUrl,
    parseIataCode,
    parseIsoDate,
    parseListLimit,
} from './utils.js';

cli({
    site: 'trip',
    name: 'flight',
    access: 'read',
    description: 'Search Trip.com one-way flights by IATA route + departure date',
    domain: 'trip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'from', required: true, positional: true, help: 'Departure IATA code (e.g. LON / LHR)' },
        { name: 'to', required: true, positional: true, help: 'Arrival IATA code (e.g. NYC / JFK)' },
        { name: 'date', required: true, help: 'Departure date (YYYY-MM-DD)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of flights (1-50)' },
    ],
    columns: [
        'rank',
        'airline',
        'departureTime', 'departureAirport',
        'arrivalTime', 'arrivalAirport',
        'duration', 'stops',
        'price', 'currency',
        'url',
    ],
    func: async (page, kwargs) => {
        const fromCode = parseIataCode('from', kwargs.from);
        const toCode = parseIataCode('to', kwargs.to);
        if (fromCode === toCode) {
            throw new ArgumentError(`--from and --to must differ (got ${fromCode})`);
        }
        const date = parseIsoDate('date', kwargs.date);
        const limit = parseListLimit(kwargs.limit);

        const searchUrl = buildFlightSearchUrl(fromCode, toCode, date);
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_FLIGHTS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('trip.com', 'Trip.com is asking for a verification; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Trip.com flight page did not render flight cards (state=${String(waitResult)})`);
        }
        const raw = await page.evaluate(buildFlightExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Trip.com flight DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            throw new EmptyResultError('trip flight', `No flights for ${fromCode} to ${toCode} on ${date}`);
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            airline: r.airline,
            departureTime: r.departureTime,
            departureAirport: r.departureAirport,
            arrivalTime: r.arrivalTime,
            arrivalAirport: r.arrivalAirport,
            duration: r.duration,
            stops: r.stops,
            price: r.price,
            currency: r.currency,
            url: searchUrl,
        }));
    },
});
