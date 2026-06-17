// archive snapshots: Wayback Machine CDX history for a URL.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

function buildWaybackUrl(timestamp, original) {
    if (!timestamp || !original) return '';
    return `https://web.archive.org/web/${timestamp}/${original}`;
}

cli({
    site: 'archive',
    name: 'snapshots',
    access: 'read',
    description: 'List Wayback Machine snapshots over time for a URL via the CDX API.',
    domain: 'archive.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'url', positional: true, required: true, help: 'URL to look up (with or without scheme).' },
        { name: 'from', type: 'string', required: false, help: 'Earliest year/timestamp (YYYY[MM[DD[hh[mm[ss]]]]])' },
        { name: 'to', type: 'string', required: false, help: 'Latest year/timestamp (YYYY[MM[DD[hh[mm[ss]]]]])' },
        { name: 'limit', type: 'int', default: 20, help: 'Max snapshots to return (max 1000).' },
    ],
    columns: ['timestamp', 'snapshot_url', 'status', 'mimetype', 'original_url'],
    func: async (args) => {
        const target = String(args.url ?? '').trim();
        if (!target) {
            throw new ArgumentError(
                'archive snapshots url cannot be empty',
                'Example: opencli archive snapshots wikipedia.org',
            );
        }
        const limit = Number(args.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('archive snapshots limit must be a positive integer');
        }
        if (limit > 1000) {
            throw new ArgumentError('archive snapshots limit must be <= 1000');
        }
        for (const key of ['from', 'to']) {
            const v = args[key];
            if (v != null && !/^\d{4,14}$/.test(String(v))) {
                throw new ArgumentError(`archive snapshots ${key} must be a digit-only timestamp (YYYY[MM[DD[hh[mm[ss]]]]])`);
            }
        }

        // Wayback CDX is served on HTTP only; the HTTPS endpoint returns 503.
        const apiUrl = new URL('http://web.archive.org/cdx/search/cdx');
        apiUrl.searchParams.set('url', target);
        apiUrl.searchParams.set('output', 'json');
        apiUrl.searchParams.set('limit', String(limit));
        if (args.from) apiUrl.searchParams.set('from', String(args.from));
        if (args.to) apiUrl.searchParams.set('to', String(args.to));

        let resp;
        try {
            resp = await fetch(apiUrl, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'opencli/1.0 (+https://github.com/jackwener/opencli)',
                },
            });
        } catch (error) {
            throw new CommandExecutionError(`archive snapshots request failed: ${error?.message || error}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`archive snapshots failed: HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`archive snapshots returned malformed JSON: ${error?.message || error}`);
        }

        // CDX returns an array of arrays; the first row is the header.
        if (!Array.isArray(data) || data.length < 2) {
            throw new EmptyResultError('archive snapshots', `No Wayback snapshots for "${target}".`);
        }
        const [header, ...rows] = data;
        const cols = {};
        header.forEach((name, i) => { cols[name] = i; });

        return rows.slice(0, limit).map(row => {
            const timestamp = String(row[cols.timestamp] ?? '');
            const original = String(row[cols.original] ?? '');
            return {
                timestamp,
                snapshot_url: buildWaybackUrl(timestamp, original),
                status: String(row[cols.statuscode] ?? ''),
                mimetype: String(row[cols.mimetype] ?? ''),
                original_url: original,
            };
        });
    },
});
