// nws alerts — active US weather alerts (filterable by state).
//
// Endpoint: GET /alerts/active                         (national)
//           GET /alerts/active?area=<state>            (per-state)
//
// Returns one row per active alert with severity, urgency, and headline.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { NWS_BASE, nwsFetch, requireOptionalState } from './utils.js';

cli({
    site: 'nws',
    name: 'alerts',
    access: 'read',
    description: 'Active US weather alerts (optionally filtered by state)',
    domain: 'api.weather.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'state', help: '2-letter US state code (e.g. CA, TX); default: all states' },
        { name: 'limit', type: 'int', default: 50, help: 'Max rows (1-500, default 50)' },
    ],
    columns: [
        'rank', 'id', 'event', 'severity', 'urgency', 'certainty',
        'headline', 'areaDesc', 'sent', 'effective', 'expires',
        'senderName', 'description', 'url',
    ],
    func: async (args) => {
        const state = requireOptionalState(args.state, 'state');
        const limit = Number(args.limit ?? 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
            throw new ArgumentError('--limit must be an integer between 1 and 500');
        }
        // NWS rejects `limit=` on /alerts/active (HTTP 400 "Query parameter not recognized").
        // We pass it as a soft client-side cap below.
        const params = ['status=actual'];
        if (state) params.push(`area=${state}`);
        const url = `${NWS_BASE}/alerts/active?${params.join('&')}`;
        const body = await nwsFetch(url, 'nws alerts');
        const features = Array.isArray(body?.features) ? body.features : [];
        if (!features.length) {
            throw new EmptyResultError('nws alerts', state ? `No active NWS alerts for ${state}.` : 'No active NWS alerts.');
        }
        return features.slice(0, limit).map((f, i) => {
            const p = f?.properties ?? {};
            return {
                rank: i + 1,
                id: String(f.id ?? p.id ?? '').trim(),
                event: String(p.event ?? '').trim(),
                severity: String(p.severity ?? '').trim(),
                urgency: String(p.urgency ?? '').trim(),
                certainty: String(p.certainty ?? '').trim(),
                headline: String(p.headline ?? '').trim(),
                areaDesc: String(p.areaDesc ?? '').trim(),
                sent: String(p.sent ?? '').trim(),
                effective: String(p.effective ?? '').trim(),
                expires: String(p.expires ?? '').trim(),
                senderName: String(p.senderName ?? '').trim(),
                description: String(p.description ?? '').trim(),
                url: String(p['@id'] ?? f.id ?? '').trim(),
            };
        });
    },
});
