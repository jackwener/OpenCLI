// archive wayback: Wayback Machine closest-snapshot lookup for a URL.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

function normalizeTimestamp(raw) {
    // Accept YYYY, YYYYMM, YYYYMMDD, YYYYMMDDhh, YYYYMMDDhhmm, YYYYMMDDhhmmss,
    // YYYY-MM-DD, or YYYY-MM-DDThh:mm:ss. Strip non-digits and validate length.
    const digits = String(raw).replace(/[^0-9]/g, '');
    if (!/^\d{4,14}$/.test(digits) || digits.length % 2 !== 0 && digits.length !== 4) {
        throw new ArgumentError('archive wayback timestamp must be YYYY[MM[DD[hh[mm[ss]]]]] or an ISO date');
    }
    return digits;
}

cli({
    site: 'archive',
    name: 'wayback',
    access: 'read',
    description: 'Look up the closest Wayback Machine snapshot for a URL.',
    domain: 'archive.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'url', positional: true, required: true, help: 'URL to look up (with or without scheme).' },
        { name: 'timestamp', type: 'string', required: false, help: 'Target timestamp (YYYY[MM[DD[hh[mm[ss]]]]] or ISO date). Defaults to most recent snapshot.' },
    ],
    columns: ['original_url', 'requested_timestamp', 'snapshot_timestamp', 'snapshot_url', 'status'],
    func: async (args) => {
        const target = String(args.url ?? '').trim();
        if (!target) {
            throw new ArgumentError(
                'archive wayback url cannot be empty',
                'Example: opencli archive wayback wikipedia.org',
            );
        }
        const timestamp = args.timestamp ? normalizeTimestamp(args.timestamp) : '';

        const apiUrl = new URL('https://archive.org/wayback/available');
        apiUrl.searchParams.set('url', target);
        if (timestamp) apiUrl.searchParams.set('timestamp', timestamp);

        let resp;
        try {
            resp = await fetch(apiUrl, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'opencli/1.0 (+https://github.com/jackwener/opencli)',
                },
            });
        } catch (error) {
            throw new CommandExecutionError(`archive wayback request failed: ${error?.message || error}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`archive wayback failed: HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`archive wayback returned malformed JSON: ${error?.message || error}`);
        }

        const snap = data?.archived_snapshots?.closest;
        if (!snap || !snap.available) {
            throw new EmptyResultError('archive wayback', `No Wayback snapshot for "${target}".`);
        }
        if (typeof snap.url !== 'string' || !snap.url || !/^\d{14}$/.test(String(snap.timestamp ?? ''))) {
            throw new CommandExecutionError('archive wayback returned malformed payload: closest snapshot is missing url/timestamp');
        }

        return [{
            original_url: String(data.url ?? target),
            requested_timestamp: timestamp,
            snapshot_timestamp: String(snap.timestamp ?? ''),
            snapshot_url: String(snap.url),
            status: String(snap.status ?? ''),
        }];
    },
});
