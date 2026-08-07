/**
 * 携程酒店详情: single-hotel profile by id (rating sub-scores, hot facilities,
 * check-in/out policy, address, and coordinates).
 *
 * Reads `window.__NEXT_DATA__.props.pageProps.hotelDetailResponse` from the SSR
 * detail page, the same source style as `hotel-search`. This surfaces the fields
 * the list row does not carry (the four rating sub-scores, hot facilities, the
 * check-in/out policy). Room-level nightly prices load via a post-SSR XHR into
 * hashed CSS-module cards, so they are out of scope here the same way `flight`'s
 * post-load price XHR is; `hotel-search` already surfaces a representative
 * nightly price per hotel.
 */
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { WAIT_FOR_HOTEL_DETAIL_JS, buildHotelDetailExtractJs, buildHotelDetailUrl, parseHotelId } from './utils.js';

cli({
    site: 'ctrip',
    name: 'hotel',
    access: 'read',
    description: '查看携程单个酒店详情（评分细分、热门设施、入离政策、位置）',
    domain: 'hotels.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'Numeric Ctrip hotel id (use `ctrip hotel-suggest` to discover; e.g. 375539)' },
    ],
    columns: [
        'hotelId', 'name', 'enName',
        'star', 'score', 'scoreLabel', 'reviewCount', 'ratingBreakdown',
        'facilities', 'checkInOut',
        'cityName', 'address', 'lat', 'lon',
        'url',
    ],
    func: async (page, kwargs) => {
        const hotelId = parseHotelId(kwargs.id);
        const url = buildHotelDetailUrl(hotelId);
        await page.goto(url);
        const waitResult = await page.evaluate(WAIT_FOR_HOTEL_DETAIL_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('hotels.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Ctrip hotel detail page did not expose SSR hotel data (state=${String(waitResult)})`);
        }
        const detail = await page.evaluate(buildHotelDetailExtractJs());
        if (!detail || typeof detail !== 'object') {
            throw new CommandExecutionError('Ctrip hotel detail SSR extraction returned malformed data');
        }
        if (!detail.hotelId || !detail.name) {
            throw new EmptyResultError('ctrip hotel', `No detail exposed for hotel id ${hotelId}`);
        }
        return [{ ...detail, url }];
    },
});
