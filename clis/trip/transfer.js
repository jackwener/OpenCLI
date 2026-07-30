/**
 * Trip.com (international) airport-transfer listing.
 *
 * Trip.com files airport transfers under an SEO path keyed on the city slug plus
 * the airport IATA code (`airport-transfers/<city>/airport-<iata>/`). A city that
 * does not match the airport bounces to the transfer landing page, so this checks
 * the landed path before extracting to avoid returning the generic landing list.
 * Rows come from the rendered `.vehicle-card` cards (see `buildTransferExtractJs`
 * in utils); the from-price is the site's representative fare, with the dated
 * pickup quote behind the booking step.
 */
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_TRANSFERS_JS,
    buildTransferExtractJs,
    buildTransferListUrl,
    parseIataCode,
    parseKeyword,
    parseListLimit,
} from './utils.js';

cli({
    site: 'trip',
    name: 'transfer',
    access: 'read',
    description: 'List Trip.com airport-transfer vehicles for a city + airport (type, seats, from-price)',
    domain: 'trip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'city', required: true, positional: true, help: 'Airport city (e.g. Bangkok / Beijing / Da Nang)' },
        { name: 'airport', required: true, positional: true, help: '3-letter airport IATA code (e.g. DMK / PKX / DAD)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of vehicles (1-50)' },
    ],
    columns: [
        'rank',
        'type',
        'passengers', 'luggage',
        'price', 'currency',
        'url',
    ],
    func: async (page, kwargs) => {
        const city = parseKeyword('city', kwargs.city);
        const airport = parseIataCode('airport', kwargs.airport);
        const limit = parseListLimit(kwargs.limit);

        const listUrl = buildTransferListUrl(city, airport);
        await page.goto(listUrl);
        const waitResult = await page.evaluate(WAIT_FOR_TRANSFERS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('trip.com', 'Trip.com is asking for a verification; complete it in your browser session and retry');
        }
        if (waitResult === 'empty') {
            throw new EmptyResultError('trip transfer', `No airport transfers for ${city} (${airport})`);
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Trip.com transfer listing did not render (state=${String(waitResult)}); check the city and airport code`);
        }
        const landedPath = await page.evaluate('location.pathname');
        if (!/\/airport-transfers\/[^/]+\/airport-[^/]+/i.test(String(landedPath))) {
            throw new CommandExecutionError(`Trip.com bounced ${city} / ${airport} to the transfer landing; check the city name matches the airport IATA code`);
        }
        const raw = await page.evaluate(buildTransferExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Trip.com transfer DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            throw new CommandExecutionError('Trip.com transfer cards rendered but parser did not find required price anchors');
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            type: r.type,
            passengers: r.passengers,
            luggage: r.luggage,
            price: r.price,
            currency: r.currency,
            url: listUrl,
        }));
    },
});
