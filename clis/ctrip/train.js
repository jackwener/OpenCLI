/**
 * 携程火车票 search: station-to-station train tickets by name + date.
 *
 * Complements `ctrip search` (which only suggests station names) with the
 * actual departures. The list page renders class-keyed cards
 * (`.card-white.list-item`), so unlike `flight` this reads by selector instead
 * of position-anchored innerText (see `buildTrainExtractJs` in utils).
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_TRAINS_JS,
    buildScrollUntilJs,
    buildTrainExtractJs,
    buildTrainListUrl,
    parseIsoDate,
    parseListLimit,
    parsePlaceName,
} from './utils.js';

cli({
    site: 'ctrip',
    name: 'train',
    access: 'read',
    description: '搜索携程火车票（按出发/到达站名 + 日期）',
    domain: 'trains.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'from', required: true, positional: true, help: 'Departure station or city name (e.g. 北京 / 上海虹桥)' },
        { name: 'to', required: true, positional: true, help: 'Arrival station or city name (e.g. 上海 / 杭州东)' },
        { name: 'date', required: true, help: 'Departure date (YYYY-MM-DD)' },
        { name: 'limit', default: 20, help: 'Number of trains (1-50)' },
    ],
    columns: [
        'rank',
        'trainNo',
        'departureTime', 'departureStation',
        'arrivalTime', 'arrivalStation',
        'duration', 'fromPrice', 'seats',
        'url',
    ],
    func: async (page, kwargs) => {
        const fromName = parsePlaceName('from', kwargs.from);
        const toName = parsePlaceName('to', kwargs.to);
        if (fromName === toName) {
            throw new ArgumentError(`--from and --to must differ (got ${fromName})`);
        }
        const date = parseIsoDate('date', kwargs.date);
        const limit = parseListLimit(kwargs.limit);

        const searchUrl = buildTrainListUrl(fromName, toName, date);
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_TRAINS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('trains.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Ctrip train page did not render train cards (state=${String(waitResult)})`);
        }
        const renderedCardCount = await page.evaluate(buildScrollUntilJs('.card-white.list-item', limit));
        const raw = await page.evaluate(buildTrainExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Ctrip train DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            if (Number(renderedCardCount) > 0) {
                throw new CommandExecutionError('Ctrip train cards rendered but parser did not find required train anchors');
            }
            throw new EmptyResultError('ctrip train', `No trains for ${fromName} to ${toName} on ${date}`);
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            trainNo: r.trainNo,
            departureTime: r.departureTime,
            departureStation: r.departureStation,
            arrivalTime: r.arrivalTime,
            arrivalStation: r.arrivalStation,
            duration: r.duration,
            fromPrice: r.fromPrice,
            seats: Array.isArray(r.seats) && r.seats.length ? r.seats.join(' / ') : null,
            url: searchUrl,
        }));
    },
});
