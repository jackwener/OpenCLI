/**
 * 携程船票 search: passenger ferry sailings by city name + date.
 *
 * Sibling of `bus`: the `ship.ctrip.com` landing SPA does not hydrate under the
 * browser bridge, so the command navigates the results route directly via its
 * `?param=<json>` deep link. Sailings arrive via the `getShipLineV2` XHR and
 * render into `.list-item-parent` rows read by stable class-keyed fields (see
 * `buildFerryExtractJs` in utils).
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_FERRY_JS,
    buildFerryExtractJs,
    buildFerryListUrl,
    buildScrollUntilJs,
    parseIsoDate,
    parseListLimit,
    parsePlaceName,
} from './utils.js';

cli({
    site: 'ctrip',
    name: 'ferry',
    access: 'read',
    description: '搜索携程船票（按出发/到达城市名 + 日期）',
    domain: 'ship.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'from', required: true, positional: true, help: 'Departure city name (e.g. 大连 / 海口)' },
        { name: 'to', required: true, positional: true, help: 'Arrival city name (e.g. 烟台 / 海安)' },
        { name: 'date', required: true, help: 'Departure date (YYYY-MM-DD)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of sailings (1-50)' },
    ],
    columns: [
        'rank',
        'shipName',
        'departureTime', 'fromPort',
        'arrivalTime', 'toPort',
        'duration', 'price', 'status',
        'url',
    ],
    func: async (page, kwargs) => {
        const fromCity = parsePlaceName('from', kwargs.from);
        const toCity = parsePlaceName('to', kwargs.to);
        if (fromCity === toCity) {
            throw new ArgumentError(`--from and --to must differ (got ${fromCity})`);
        }
        const date = parseIsoDate('date', kwargs.date);
        const limit = parseListLimit(kwargs.limit);

        const searchUrl = buildFerryListUrl(fromCity, toCity, date);
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_FERRY_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('ship.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Ctrip ferry page did not render sailing rows (state=${String(waitResult)})`);
        }
        const renderedCardCount = await page.evaluate(buildScrollUntilJs('.list-item-parent', limit));
        const raw = await page.evaluate(buildFerryExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Ctrip ferry DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            if (Number(renderedCardCount) > 0) {
                throw new CommandExecutionError('Ctrip ferry rows rendered but parser did not find required sailing anchors');
            }
            throw new EmptyResultError('ctrip ferry', `No sailings for ${fromCity} to ${toCity} on ${date}`);
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            shipName: r.shipName,
            departureTime: r.departureTime,
            fromPort: r.fromPort,
            arrivalTime: r.arrivalTime,
            toPort: r.toPort,
            duration: r.duration,
            price: r.price,
            status: r.status,
            url: searchUrl,
        }));
    },
});
