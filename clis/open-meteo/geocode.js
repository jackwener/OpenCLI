// open-meteo geocode — resolve a city / place name to lat/lon.
//
// Hits `https://geocoding-api.open-meteo.com/v1/search?name=…`. Returns the
// agent-useful projection: name, country, admin1, latitude, longitude,
// elevation, population, timezone, feature code. The (latitude, longitude)
// pair round-trips into `open-meteo forecast`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { GEOCODE_BASE, meteoFetch, requireBoundedInt, requireString } from './utils.js';

cli({
    site: 'open-meteo',
    name: 'geocode',
    access: 'read',
    description: 'Resolve a city / place name to lat/lon via Open-Meteo geocoding',
    domain: 'geocoding-api.open-meteo.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'Place name (e.g. "Tokyo", "San Francisco", "Munich")' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results (1-100)' },
    ],
    columns: [
        'rank', 'id', 'name', 'country', 'admin1', 'latitude', 'longitude',
        'elevation', 'population', 'timezone', 'featureCode', 'url',
    ],
    func: async (args) => {
        const name = requireString(args.name, 'name');
        const limit = requireBoundedInt(args.limit, 10, 100);
        const url = `${GEOCODE_BASE}/search?name=${encodeURIComponent(name)}&count=${limit}`;
        const body = await meteoFetch(url, 'open-meteo geocode');
        const list = Array.isArray(body?.results) ? body.results : [];
        if (!list.length) {
            throw new EmptyResultError('open-meteo geocode', `No Open-Meteo locations matched "${name}".`);
        }
        return list.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            id: typeof r.id === 'number' ? r.id : null,
            name: String(r.name ?? '').trim(),
            country: String(r.country ?? '').trim() || null,
            admin1: String(r.admin1 ?? '').trim() || null,
            latitude: typeof r.latitude === 'number' ? r.latitude : null,
            longitude: typeof r.longitude === 'number' ? r.longitude : null,
            elevation: typeof r.elevation === 'number' ? r.elevation : null,
            population: typeof r.population === 'number' ? r.population : null,
            timezone: String(r.timezone ?? '').trim() || null,
            featureCode: String(r.feature_code ?? '').trim() || null,
            url: r.id ? `https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=10/${r.latitude}/${r.longitude}` : '',
        }));
    },
});
