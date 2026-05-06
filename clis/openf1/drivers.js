// openf1 drivers — F1 drivers entered for a specific session.
//
// Endpoint: GET /drivers?session_key=<key>
// session_key comes from `openf1 sessions`. Returns one row per driver entry
// (driver_number is per-session, not stable across seasons for some drivers).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { openf1Fetch, optionalInt, OPENF1_BASE } from './utils.js';

cli({
    site: 'openf1',
    name: 'drivers',
    access: 'read',
    description: 'F1 drivers entered for a session (use sessions to find session_key)',
    domain: 'openf1.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'session-key', positional: true, required: true, help: 'session_key from `openf1 sessions` (e.g. 9472)' },
        { name: 'driver-number', help: 'Filter to a specific driver number (e.g. 1, 44)' },
    ],
    columns: [
        'rank', 'driverNumber', 'broadcastName', 'fullName', 'nameAcronym',
        'firstName', 'lastName', 'teamName', 'teamColour',
        'countryCode', 'sessionKey', 'meetingKey', 'headshotUrl',
    ],
    func: async (args) => {
        const sessionKey = optionalInt(args['session-key'], 'session-key');
        if (sessionKey == null) {
            throw new ArgumentError('<session-key> is required (use `openf1 sessions` to find one).');
        }
        const driverNumber = optionalInt(args['driver-number'], 'driver-number');
        const params = new URLSearchParams({ session_key: String(sessionKey) });
        if (driverNumber != null) params.set('driver_number', String(driverNumber));
        const url = `${OPENF1_BASE}/drivers?${params.toString()}`;
        const body = await openf1Fetch(url, 'openf1 drivers');
        if (!Array.isArray(body) || body.length === 0) {
            throw new EmptyResultError('openf1 drivers', `api.openf1.org returned no drivers for session_key=${sessionKey}.`);
        }
        return body.map((d, i) => ({
            rank: i + 1,
            driverNumber: d?.driver_number ?? null,
            broadcastName: d?.broadcast_name ?? null,
            fullName: d?.full_name ?? null,
            nameAcronym: d?.name_acronym ?? null,
            firstName: d?.first_name ?? null,
            lastName: d?.last_name ?? null,
            teamName: d?.team_name ?? null,
            teamColour: d?.team_colour ?? null,
            countryCode: d?.country_code ?? null,
            sessionKey: d?.session_key ?? null,
            meetingKey: d?.meeting_key ?? null,
            headshotUrl: d?.headshot_url ?? null,
        }));
    },
});
