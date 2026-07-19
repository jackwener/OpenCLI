/**
 * 携程汽车票 search: intercity coach tickets by city name + date.
 *
 * The newbus SPA landing (`bus.ctrip.com/`) does not hydrate under the browser
 * bridge, but the results route renders directly from a `?param=<json>` deep
 * link (the payload the app's own search handler posts to `/list`). Schedules
 * arrive via the `busListV2` XHR and render into `.list-item-parent` rows read
 * by stable utility-class fields (see `buildBusExtractJs` in utils), so this
 * reads by selector rather than positional innerText.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_BUS_JS,
    buildBusExtractJs,
    buildBusListUrl,
    buildScrollUntilJs,
    parseIsoDate,
    parseListLimit,
    parsePlaceName,
} from './utils.js';

cli({
    site: 'ctrip',
    name: 'bus',
    access: 'read',
    description: '搜索携程汽车票（按出发/到达城市名 + 日期）',
    domain: 'bus.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'from', required: true, positional: true, help: 'Departure city name (e.g. 北京 / 上海)' },
        { name: 'to', required: true, positional: true, help: 'Arrival city name (e.g. 天津 / 杭州)' },
        { name: 'date', required: true, help: 'Departure date (YYYY-MM-DD)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of departures (1-50)' },
    ],
    columns: [
        'rank',
        'departureTime',
        'fromStation', 'toStation',
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

        const searchUrl = buildBusListUrl(fromCity, toCity, date);
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_BUS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('bus.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Ctrip bus page did not render schedule rows (state=${String(waitResult)})`);
        }
        const renderedCardCount = await page.evaluate(buildScrollUntilJs('.list-item-parent', limit));
        const raw = await page.evaluate(buildBusExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Ctrip bus DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            if (Number(renderedCardCount) > 0) {
                throw new CommandExecutionError('Ctrip bus rows rendered but parser did not find required schedule anchors');
            }
            throw new EmptyResultError('ctrip bus', `No coaches for ${fromCity} to ${toCity} on ${date}`);
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            departureTime: r.departureTime,
            fromStation: r.fromStation,
            toStation: r.toStation,
            duration: r.duration,
            price: r.price,
            status: r.status,
            url: searchUrl,
        }));
    },
});
