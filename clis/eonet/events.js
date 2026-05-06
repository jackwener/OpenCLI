// eonet events — natural events (wildfires, storms, volcanoes, icebergs).
//
// Endpoint: GET /events?limit=&days=&status=&category=
// `status` is `open` (active) or `closed` (resolved); default = `open`.
// `category` accepts a category id (drought, dustHaze, earthquakes, floods,
//   landslides, manmade, seaLakeIce, severeStorms, snow, tempExtremes,
//   volcanoes, waterColor, wildfires).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { eonetFetch, requireBoundedInt, EONET_BASE } from './utils.js';

cli({
    site: 'eonet',
    name: 'events',
    access: 'read',
    description: 'Natural events from NASA EONET (wildfires / storms / volcanoes / icebergs)',
    domain: 'gsfc.nasa.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max rows (1-200, default 20)' },
        { name: 'days', type: 'int', default: 30, help: 'Days back to search (1-365, default 30)' },
        { name: 'status', help: 'Event status: open (active) | closed (resolved). Default: open' },
        { name: 'category', help: 'Category id (e.g. wildfires, volcanoes, severeStorms)' },
    ],
    columns: [
        'rank', 'id', 'title', 'description', 'closed', 'categories', 'sources',
        'geometryType', 'lastDate', 'magnitudeValue', 'magnitudeUnit', 'link',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 20, 200);
        const days = requireBoundedInt(args.days, 30, 365, 'days');
        const status = args.status == null || args.status === '' ? 'open' : String(args.status);
        if (!['open', 'closed', 'all'].includes(status)) {
            throw new ArgumentError(`--status must be one of: open, closed, all`);
        }
        const params = new URLSearchParams({ limit: String(limit), days: String(days), status });
        if (args.category) params.set('category', String(args.category));
        const url = `${EONET_BASE}/events?${params.toString()}`;
        const body = await eonetFetch(url, 'eonet events');
        const list = Array.isArray(body?.events) ? body.events : [];
        if (!list.length) {
            throw new EmptyResultError('eonet events', 'eonet.gsfc.nasa.gov returned no events for these filters.');
        }
        return list.map((e, i) => {
            const cats = Array.isArray(e?.categories) ? e.categories.map((c) => c?.title).filter(Boolean) : [];
            const sources = Array.isArray(e?.sources) ? e.sources.map((s) => s?.id).filter(Boolean) : [];
            const geoms = Array.isArray(e?.geometry) ? e.geometry : [];
            const lastGeom = geoms[geoms.length - 1] ?? null;
            return {
                rank: i + 1,
                id: e?.id ?? null,
                title: e?.title ?? null,
                description: e?.description ?? null, // can be null per spec — preserve
                closed: e?.closed ?? null,            // null when still open
                categories: cats.length ? cats.join(', ') : null,
                sources: sources.length ? sources.join(', ') : null,
                geometryType: lastGeom?.type ?? null,  // Point or Polygon
                lastDate: lastGeom?.date ?? null,
                magnitudeValue: lastGeom?.magnitudeValue ?? null,
                magnitudeUnit: lastGeom?.magnitudeUnit ?? null,
                link: e?.link ?? null,
            };
        });
    },
});
