// nasa-apod today — fetch a single Astronomy Picture Of the Day.
//
// With no args, returns the current day's APOD. Pass --date to fetch a
// specific historical day (>= 1995-06-16, the APOD launch date).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    APOD_BASE,
    apodFetch,
    apodKey,
    projectApod,
    requireOptionalDate,
} from './utils.js';

cli({
    site: 'nasa-apod',
    name: 'today',
    access: 'read',
    description: 'NASA Astronomy Picture Of the Day (single date, default: today)',
    domain: 'api.nasa.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'date', help: 'YYYY-MM-DD (default: today, must be >= 1995-06-16)' },
    ],
    columns: [
        'date', 'title', 'mediaType', 'explanation',
        'url', 'hdUrl', 'copyright', 'serviceVersion', 'pageUrl',
    ],
    func: async (args) => {
        const date = requireOptionalDate(args.date);
        const params = new URLSearchParams({ api_key: apodKey() });
        if (date) params.set('date', date);
        const url = `${APOD_BASE}?${params.toString()}`;
        const body = await apodFetch(url, 'nasa-apod today');
        if (!body || typeof body !== 'object' || !body.date) {
            throw new EmptyResultError('nasa-apod today', `NASA APOD returned no entry for "${date ?? 'today'}".`);
        }
        return [projectApod(body)];
    },
});
