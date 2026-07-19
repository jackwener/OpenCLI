/**
 * Trip.com (international) train timetable by route.
 *
 * Trip.com exposes per-route SEO timetables at
 * `trains/<country>/route/<from>-to-<to>/`, so `--country` is required and the
 * city names are slugified into the URL. The page lists journeys as timetable
 * rows (departure / arrival times, stations, duration, changes) read by stable
 * class fields (see `buildTrainExtractJs` in utils); per-journey fares sit behind
 * the booking step and are out of scope here.
 */
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_TRAINS_JS,
    buildTrainExtractJs,
    buildTrainRouteUrl,
    parseKeyword,
    parseListLimit,
} from './utils.js';

cli({
    site: 'trip',
    name: 'train',
    access: 'read',
    description: 'Show a Trip.com train route timetable (departure/arrival times, duration, changes)',
    domain: 'trip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'from', required: true, positional: true, help: 'Departure city (e.g. London / Paris / Shanghai)' },
        { name: 'to', required: true, positional: true, help: 'Arrival city (e.g. Manchester / Lyon / Beijing)' },
        { name: 'country', required: true, help: 'Route country slug (e.g. uk / france / italy / spain / germany / china)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of journeys (1-50)' },
    ],
    columns: [
        'rank',
        'departureTime', 'fromStation',
        'arrivalTime', 'toStation',
        'duration', 'changes',
        'url',
    ],
    func: async (page, kwargs) => {
        const from = parseKeyword('from', kwargs.from);
        const to = parseKeyword('to', kwargs.to);
        const country = parseKeyword('country', kwargs.country);
        const limit = parseListLimit(kwargs.limit);

        const searchUrl = buildTrainRouteUrl(country, from, to);
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_TRAINS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('trip.com', 'Trip.com is asking for a verification; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Trip.com train timetable did not render (state=${String(waitResult)}); check the city names and --country`);
        }
        const raw = await page.evaluate(buildTrainExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Trip.com train DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            throw new EmptyResultError('trip train', `No timetable for ${from} to ${to} (${country})`);
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            departureTime: r.departureTime,
            fromStation: r.fromStation,
            arrivalTime: r.arrivalTime,
            toStation: r.toStation,
            duration: r.duration,
            changes: r.changes,
            url: searchUrl,
        }));
    },
});
