/**
 * Trip.com (international) single-hotel detail by id: rating breakdown, popular
 * amenities, check-in/out policy, address, and coordinates.
 *
 * Reads `__NEXT_DATA__.props.pageProps.hotelDetailResponse` from the SSR detail
 * page, the same SSR shape the mainland `ctrip hotel` detail uses. This surfaces
 * the fields the `hotel-search` list row does not carry. Room-level nightly
 * prices load via a post-SSR XHR and are out of scope here; `hotel-search`
 * already reports a representative nightly price per hotel.
 */
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { WAIT_FOR_HOTEL_DETAIL_JS, buildHotelDetailExtractJs, buildHotelDetailUrl, parseHotelId } from './utils.js';

cli({
    site: 'trip',
    name: 'hotel',
    access: 'read',
    description: 'Show a Trip.com hotel detail by id (rating breakdown, amenities, check-in/out policy)',
    domain: 'trip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'Numeric Trip.com hotel id (discover via the hotels list; e.g. 715233)' },
    ],
    columns: [
        'hotelId', 'name', 'enName',
        'star', 'score', 'scoreLabel', 'reviewCount', 'ratingBreakdown',
        'facilities', 'checkInOut',
        'cityName', 'address', 'lat', 'lon',
        'url',
    ],
    func: async (page, kwargs) => {
        const hotelId = parseHotelId('id', kwargs.id);
        const url = buildHotelDetailUrl(hotelId);
        await page.goto(url);
        const waitResult = await page.evaluate(WAIT_FOR_HOTEL_DETAIL_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('trip.com', 'Trip.com is asking for a verification; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Trip.com hotel detail page did not expose SSR hotel data (state=${String(waitResult)})`);
        }
        const detail = await page.evaluate(buildHotelDetailExtractJs());
        if (!detail || typeof detail !== 'object') {
            throw new CommandExecutionError('Trip.com hotel detail SSR extraction returned malformed data');
        }
        if (!detail.hotelId || !detail.name) {
            throw new EmptyResultError('trip hotel', `No detail exposed for hotel id ${hotelId}`);
        }
        return [{ ...detail, url }];
    },
});
