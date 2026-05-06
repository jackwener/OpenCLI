// nasa-apod range — fetch APOD entries for a date range (inclusive).
//
// NASA's range endpoint returns one entry per day between start_date and
// end_date. Sorted newest-first by the adapter for consistency with the
// rest of opencli's listing commands. Set NASA_API_KEY for higher quotas
// (DEMO_KEY caps at ~30/hr).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    APOD_BASE,
    apodFetch,
    apodKey,
    projectApod,
    requireDate,
    requireOptionalDate,
} from './utils.js';

cli({
    site: 'nasa-apod',
    name: 'range',
    access: 'read',
    description: 'NASA APOD entries between two dates, newest first',
    domain: 'api.nasa.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'start', positional: true, required: true, help: 'Start date YYYY-MM-DD (inclusive)' },
        { name: 'end', help: 'End date YYYY-MM-DD (inclusive, default: same day as start)' },
    ],
    columns: [
        'rank', 'date', 'title', 'mediaType', 'url', 'hdUrl', 'copyright', 'pageUrl',
    ],
    func: async (args) => {
        const start = requireDate(args.start, 'start');
        const end = requireOptionalDate(args.end, 'end') ?? start;
        if (end < start) {
            throw new ArgumentError('nasa-apod end date must be >= start date');
        }
        const params = new URLSearchParams({
            api_key: apodKey(),
            start_date: start,
            end_date: end,
        });
        const url = `${APOD_BASE}?${params.toString()}`;
        const body = await apodFetch(url, 'nasa-apod range');
        const list = Array.isArray(body) ? body : [];
        if (!list.length) {
            throw new EmptyResultError('nasa-apod range', `NASA APOD returned no entries between ${start} and ${end}.`);
        }
        // NASA returns oldest→newest; sort newest-first to match listing convention.
        const sorted = list.slice().sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
        return sorted.map((item, i) => {
            const r = projectApod(item);
            return {
                rank: i + 1,
                date: r.date,
                title: r.title,
                mediaType: r.mediaType,
                url: r.url,
                hdUrl: r.hdUrl,
                copyright: r.copyright,
                pageUrl: r.pageUrl,
            };
        });
    },
});
