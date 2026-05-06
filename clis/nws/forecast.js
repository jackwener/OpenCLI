// nws forecast — US weather forecast for a lat/lon point.
//
// Endpoint chain:
//   1. GET /points/<lat>,<lon>            → {properties.forecast: <url>, gridId, ...}
//   2. GET <forecast url>                 → {properties.periods: [{name, temperature, ...}]}
//
// Returns one row per forecast period (NWS exposes ~14 periods, day + night).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { NWS_BASE, nwsFetch, requireCoord } from './utils.js';

cli({
    site: 'nws',
    name: 'forecast',
    access: 'read',
    description: 'US weather forecast for a lat/lon point (National Weather Service)',
    domain: 'api.weather.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'point', positional: true, required: true, help: 'Latitude,longitude (e.g. "37.7749,-122.4194")' },
    ],
    columns: [
        'rank', 'name', 'startTime', 'endTime', 'isDaytime',
        'temperature', 'temperatureUnit', 'windSpeed', 'windDirection',
        'shortForecast', 'detailedForecast', 'precipitationProbability',
    ],
    func: async (args) => {
        const point = requireCoord(args.point, 'point');
        const pointUrl = `${NWS_BASE}/points/${point.str}`;
        const pointBody = await nwsFetch(pointUrl, 'nws forecast (point lookup)');
        const forecastUrl = pointBody?.properties?.forecast;
        if (typeof forecastUrl !== 'string' || !forecastUrl) {
            throw new EmptyResultError('nws forecast', `NWS does not have a forecast for ${point.str} (likely outside US coverage).`);
        }
        const forecastBody = await nwsFetch(forecastUrl, 'nws forecast');
        const periods = Array.isArray(forecastBody?.properties?.periods) ? forecastBody.properties.periods : [];
        if (!periods.length) {
            throw new EmptyResultError('nws forecast', 'NWS returned an empty periods list.');
        }
        return periods.map((p, i) => ({
            rank: i + 1,
            name: String(p.name ?? '').trim(),
            startTime: String(p.startTime ?? '').trim(),
            endTime: String(p.endTime ?? '').trim(),
            isDaytime: Boolean(p.isDaytime),
            temperature: p.temperature != null ? Number(p.temperature) : null,
            temperatureUnit: String(p.temperatureUnit ?? '').trim(),
            windSpeed: String(p.windSpeed ?? '').trim(),
            windDirection: String(p.windDirection ?? '').trim(),
            shortForecast: String(p.shortForecast ?? '').trim(),
            detailedForecast: String(p.detailedForecast ?? '').trim(),
            precipitationProbability: p?.probabilityOfPrecipitation?.value != null
                ? Number(p.probabilityOfPrecipitation.value)
                : null,
        }));
    },
});
