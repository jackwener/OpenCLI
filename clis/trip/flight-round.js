/**
 * Trip.com (international) round-trip flight search by IATA route + dates.
 *
 * Complements one-way `flight`: the round-trip results page renders the same
 * `.result-item` outbound cards (priced for the round trip), so this reuses the
 * shared flight extractor and wait helper against a `triptype=rt` search URL.
 * Rows missing the airline, both airports, or both times are dropped.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_FLIGHTS_JS,
    buildFlightExtractJs,
    buildFlightRoundSearchUrl,
    parseIataCode,
    parseIsoDate,
    parseListLimit,
} from './utils.js';

cli({
    site: 'trip',
    name: 'flight-round',
    access: 'read',
    description: 'Search Trip.com round-trip flights by IATA route + depart/return dates',
    domain: 'trip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'from', required: true, positional: true, help: 'Departure IATA code (e.g. LON / LHR)' },
        { name: 'to', required: true, positional: true, help: 'Arrival IATA code (e.g. NYC / JFK)' },
        { name: 'depart', required: true, help: 'Outbound date (YYYY-MM-DD)' },
        { name: 'return', required: true, help: 'Return date (YYYY-MM-DD)' },
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
        const depart = parseIsoDate('depart', kwargs.depart);
        const ret = parseIsoDate('return', kwargs.return);
        if (depart >= ret) {
            throw new ArgumentError(`--depart must be before --return (got ${depart} .. ${ret})`);
        }
        const limit = parseListLimit(kwargs.limit);

        const searchUrl = buildFlightRoundSearchUrl(fromCode, toCode, depart, ret);
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
            throw new EmptyResultError('trip flight-round', `No round-trip flights for ${fromCode} to ${toCode} on ${depart} .. ${ret}`);
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
