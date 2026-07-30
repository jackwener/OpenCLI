/**
 * Trip.com (international) hotel listing by city id + check-in/out date range.
 *
 * Trip.com renders hotel results client-side into `.hotel-card` cards keyed by
 * stable class fields, so this reads by selector (see `buildHotelExtractJs` in
 * utils) rather than positional innerText. Cards without a hotel name are
 * dropped rather than surfaced with blanks.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_HOTELS_JS,
    buildHotelExtractJs,
    buildHotelSearchUrl,
    parseCityId,
    parseIsoDate,
    parseListLimit,
} from './utils.js';

cli({
    site: 'trip',
    name: 'hotel-search',
    access: 'read',
    description: 'List Trip.com hotels for a city id + check-in/out date range',
    domain: 'trip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'city', required: true, positional: true, help: 'Numeric Trip.com city id (discover via the hotels search box; e.g. 338 for London)' },
        { name: 'checkin', required: true, help: 'Check-in date (YYYY-MM-DD)' },
        { name: 'checkout', required: true, help: 'Check-out date (YYYY-MM-DD)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of hotels (1-50)' },
    ],
    columns: [
        'rank',
        'name', 'score', 'reviewLabel', 'reviews',
        'location', 'room',
        'price', 'currency',
        'url',
    ],
    func: async (page, kwargs) => {
        const cityId = parseCityId('city', kwargs.city);
        const checkin = parseIsoDate('checkin', kwargs.checkin);
        const checkout = parseIsoDate('checkout', kwargs.checkout);
        if (checkin >= checkout) {
            throw new ArgumentError(`--checkin must be before --checkout (got ${checkin} .. ${checkout})`);
        }
        const limit = parseListLimit(kwargs.limit);

        const searchUrl = buildHotelSearchUrl(cityId, checkin, checkout);
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_HOTELS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('trip.com', 'Trip.com is asking for a verification; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Trip.com hotel page did not render hotel cards (state=${String(waitResult)})`);
        }
        const raw = await page.evaluate(buildHotelExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Trip.com hotel DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            throw new EmptyResultError('trip hotel-search', `No hotels for city ${cityId} on ${checkin} .. ${checkout}`);
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            name: r.name,
            score: r.score,
            reviewLabel: r.reviewLabel,
            reviews: r.reviews,
            location: r.location,
            room: r.room,
            price: r.price,
            currency: r.currency,
            url: searchUrl,
        }));
    },
});
