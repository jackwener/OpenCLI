/**
 * 携程门票 / 景点: a destination's top attractions by city id.
 *
 * you.ctrip.com's place page renders the top-rated attractions for a city as
 * `/sight/<city>/<id>.html` links carrying the name, rating, and review count, so
 * this navigates the place page (routed by the numeric city id, discover it via
 * `ctrip search`) and reads those links by their stable pattern (see
 * `buildAttractionExtractJs` in utils). Per-sight ticket prices sit on each
 * attraction's own detail page and are out of scope here.
 */
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_ATTRACTIONS_JS,
    buildAttractionExtractJs,
    buildAttractionPlaceUrl,
    parseCityId,
    parseListLimit,
} from './utils.js';

cli({
    site: 'ctrip',
    name: 'attraction',
    access: 'read',
    description: '列出携程某城市的热门景点（评分/点评数，城市 id 经 ctrip search 获取）',
    domain: 'you.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'city', required: true, positional: true, help: 'Numeric Ctrip city id (from `ctrip search`, e.g. 1 for 北京)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of attractions (1-50)' },
    ],
    columns: [
        'rank',
        'name',
        'rating', 'reviews',
        'url',
    ],
    func: async (page, kwargs) => {
        const cityId = parseCityId(kwargs.city);
        const limit = parseListLimit(kwargs.limit);

        const placeUrl = buildAttractionPlaceUrl(cityId);
        await page.goto(placeUrl);
        const waitResult = await page.evaluate(WAIT_FOR_ATTRACTIONS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('you.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Ctrip place page did not render attraction links (state=${String(waitResult)}); check the city id`);
        }
        const raw = await page.evaluate(buildAttractionExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Ctrip attraction DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            throw new CommandExecutionError('Ctrip attraction links rendered but parser did not find required sight anchors');
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            name: r.name,
            rating: r.rating,
            reviews: r.reviews,
            url: r.url,
        }));
    },
});
