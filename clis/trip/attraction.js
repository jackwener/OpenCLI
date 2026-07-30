/**
 * Trip.com (international) attractions and experiences search by destination
 * keyword.
 *
 * The things-to-do products load client-side into hashed CSS-module cards, so
 * this anchors on each card's stable `things-to-do/detail/<id>` link (which also
 * gives a real per-row `url`) and reads rating / reviews / booked / price from
 * the card text by data-format pattern (see `buildAttractionExtractJs` in utils).
 */
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_ATTRACTIONS_JS,
    buildAttractionExtractJs,
    buildAttractionSearchUrl,
    parseKeyword,
    parseListLimit,
} from './utils.js';

cli({
    site: 'trip',
    name: 'attraction',
    access: 'read',
    description: 'Search Trip.com attractions and experiences by destination keyword',
    domain: 'trip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Destination or attraction keyword (e.g. Tokyo / Paris / Louvre)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results (1-50)' },
    ],
    columns: [
        'rank',
        'name',
        'rating', 'reviews', 'booked',
        'price', 'currency',
        'url',
    ],
    func: async (page, kwargs) => {
        const query = parseKeyword('query', kwargs.query);
        const limit = parseListLimit(kwargs.limit);

        const searchUrl = buildAttractionSearchUrl(query);
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_ATTRACTIONS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('trip.com', 'Trip.com is asking for a verification; complete it in your browser session and retry');
        }
        if (waitResult === 'empty') {
            throw new EmptyResultError('trip attraction', `No attractions for "${query}"`);
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Trip.com things-to-do page did not render product cards (state=${String(waitResult)})`);
        }
        const raw = await page.evaluate(buildAttractionExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Trip.com attraction DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            throw new CommandExecutionError('Trip.com attraction cards rendered but parser did not find required detail-link anchors');
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            name: r.name,
            rating: r.rating,
            reviews: r.reviews,
            booked: r.booked,
            price: r.price,
            currency: 'USD',
            url: r.url,
        }));
    },
});
