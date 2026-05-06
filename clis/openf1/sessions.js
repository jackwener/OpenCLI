// openf1 sessions — F1 race / qualifying / practice sessions, filterable by year + type.
//
// Endpoint: GET /sessions?year=&session_type=&country_code=
// Each session has a `session_key` that round-trips to drivers / car-data / laps.
// Sorted by `date_start` ascending (server-side).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { openf1Fetch, requireBoundedInt, optionalInt, OPENF1_BASE } from './utils.js';

cli({
    site: 'openf1',
    name: 'sessions',
    access: 'read',
    description: 'F1 sessions (Race / Qualifying / Practice / Sprint) with session_key for drilldown',
    domain: 'openf1.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 30, help: 'Max rows (1-200, default 30)' },
        { name: 'year', help: 'Filter by season year (e.g. 2024)' },
        { name: 'session-type', help: 'Race | Qualifying | Practice | Sprint | Sprint Shootout' },
        { name: 'country-code', help: '3-letter country code (e.g. BRN, MON, GBR)' },
    ],
    columns: [
        'rank', 'sessionKey', 'meetingKey', 'sessionType', 'sessionName',
        'circuit', 'countryCode', 'countryName', 'location',
        'dateStart', 'dateEnd', 'gmtOffset', 'year', 'isCancelled',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 30, 200);
        const year = optionalInt(args.year, 'year');
        const params = new URLSearchParams();
        if (year != null) params.set('year', String(year));
        if (args['session-type']) params.set('session_type', String(args['session-type']));
        if (args['country-code']) params.set('country_code', String(args['country-code']).toUpperCase());
        const qs = params.toString();
        const url = `${OPENF1_BASE}/sessions${qs ? `?${qs}` : ''}`;
        const body = await openf1Fetch(url, 'openf1 sessions');
        if (!Array.isArray(body) || body.length === 0) {
            throw new EmptyResultError('openf1 sessions', 'api.openf1.org returned no sessions for these filters.');
        }
        return body.slice(0, limit).map((s, i) => ({
            rank: i + 1,
            sessionKey: s?.session_key ?? null,
            meetingKey: s?.meeting_key ?? null,
            sessionType: s?.session_type ?? null,
            sessionName: s?.session_name ?? null,
            circuit: s?.circuit_short_name ?? null,
            countryCode: s?.country_code ?? null,
            countryName: s?.country_name ?? null,
            location: s?.location ?? null,
            dateStart: s?.date_start ?? null,
            dateEnd: s?.date_end ?? null,
            gmtOffset: s?.gmt_offset ?? null,
            year: s?.year ?? null,
            isCancelled: s?.is_cancelled ?? null,
        }));
    },
});
