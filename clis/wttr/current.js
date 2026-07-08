// wttr current — current weather conditions for a city / lat,lon / airport code.
//
// Endpoint: GET /<location>?format=j1  → returns current_condition + nearest_area.
// One row (current snapshot).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { requireString, wttrFetch, pickWeatherDesc } from './utils.js';

cli({
    site: 'wttr',
    name: 'current',
    access: 'read',
    description: 'Current weather conditions for a location (city, lat,lon, or airport code)',
    domain: 'wttr.in',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'location',
            positional: true,
            required: true,
            help: 'City name, "lat,lon", airport ICAO code, or "@domain"',
        },
    ],
    columns: [
        'location', 'region', 'country', 'latitude', 'longitude',
        'observedAt', 'tempC', 'tempF', 'feelsLikeC', 'feelsLikeF',
        'description', 'humidity', 'cloudCover', 'pressure',
        'precipMm', 'visibilityKm', 'uvIndex',
        'windKmph', 'windDirection', 'windDirectionDegree',
    ],
    func: async (args) => {
        const location = requireString(args.location, 'location');
        const body = await wttrFetch(location, 'wttr current');
        const cur = Array.isArray(body?.current_condition) ? body.current_condition[0] : null;
        if (!cur) {
            throw new EmptyResultError('wttr current', `wttr.in returned no current conditions for "${location}".`);
        }
        const area = Array.isArray(body?.nearest_area) ? body.nearest_area[0] : null;
        return [{
            location: pickWeatherDesc(area?.areaName) || location,
            region: pickWeatherDesc(area?.region),
            country: pickWeatherDesc(area?.country),
            latitude: area?.latitude ?? null,
            longitude: area?.longitude ?? null,
            observedAt: cur.localObsDateTime ?? null,
            tempC: cur.temp_C != null ? Number(cur.temp_C) : null,
            tempF: cur.temp_F != null ? Number(cur.temp_F) : null,
            feelsLikeC: cur.FeelsLikeC != null ? Number(cur.FeelsLikeC) : null,
            feelsLikeF: cur.FeelsLikeF != null ? Number(cur.FeelsLikeF) : null,
            description: pickWeatherDesc(cur.weatherDesc),
            humidity: cur.humidity != null ? Number(cur.humidity) : null,
            cloudCover: cur.cloudcover != null ? Number(cur.cloudcover) : null,
            pressure: cur.pressure != null ? Number(cur.pressure) : null,
            precipMm: cur.precipMM != null ? Number(cur.precipMM) : null,
            visibilityKm: cur.visibility != null ? Number(cur.visibility) : null,
            uvIndex: cur.uvIndex != null ? Number(cur.uvIndex) : null,
            windKmph: cur.windspeedKmph != null ? Number(cur.windspeedKmph) : null,
            windDirection: cur.winddir16Point ?? null,
            windDirectionDegree: cur.winddirDegree != null ? Number(cur.winddirDegree) : null,
        }];
    },
});
