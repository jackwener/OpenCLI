/**
 * Trip.com (international) car-rental listing by city.
 *
 * Trip.com files car-rental listings under an SEO path whose text slugs are
 * cosmetic; only the numeric carhire city id routes the page, so this takes that
 * id (discover it via the carhire search box) and reads the rendered `.card-item`
 * cards by stable class fields (see `buildCarExtractJs` in utils). The listing
 * carries the site's near-term representative daily price; a dated pickup /
 * drop-off quote sits behind the booking step and is out of scope here.
 */
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_CARS_JS,
    buildCarExtractJs,
    buildCarListUrl,
    parseCityId,
    parseListLimit,
} from './utils.js';

cli({
    site: 'trip',
    name: 'car',
    access: 'read',
    description: 'List Trip.com car-rental vehicles for a city (category, model, seats, daily price)',
    domain: 'trip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'city', required: true, positional: true, help: 'Numeric Trip.com carhire city id (discover via the carhire search box)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of vehicles (1-50)' },
    ],
    columns: [
        'rank',
        'category', 'vehicle',
        'seats',
        'price', 'currency',
        'url',
    ],
    func: async (page, kwargs) => {
        const cityId = parseCityId('city', kwargs.city);
        const limit = parseListLimit(kwargs.limit);

        const listUrl = buildCarListUrl(cityId);
        await page.goto(listUrl);
        const waitResult = await page.evaluate(WAIT_FOR_CARS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('trip.com', 'Trip.com is asking for a verification; complete it in your browser session and retry');
        }
        if (waitResult === 'empty') {
            throw new EmptyResultError('trip car', `No car rentals for city id ${cityId}`);
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Trip.com car listing did not render (state=${String(waitResult)}); check the carhire city id`);
        }
        const raw = await page.evaluate(buildCarExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Trip.com car DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            throw new CommandExecutionError('Trip.com car cards rendered but parser did not find required price anchors');
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            category: r.category,
            vehicle: r.vehicle,
            seats: r.seats,
            price: r.price,
            currency: r.currency,
            url: listUrl,
        }));
    },
});
