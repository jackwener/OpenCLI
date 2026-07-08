// wttr forecast — multi-day forecast for a location.
//
// Endpoint: GET /<location>?format=j1  → returns weather[] (3 days max on free tier).
// Each day is collapsed into a single row with min/max/avg + summary description.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { requireString, wttrFetch, pickWeatherDesc } from './utils.js';

cli({
    site: 'wttr',
    name: 'forecast',
    access: 'read',
    description: 'Multi-day weather forecast (up to 3 days, wttr.in free tier max)',
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
        {
            name: 'days',
            type: 'int',
            default: 3,
            help: 'Max forecast days (1-3, wttr.in caps the response at 3 days)',
        },
    ],
    columns: [
        'rank', 'date', 'minTempC', 'maxTempC', 'avgTempC',
        'minTempF', 'maxTempF', 'avgTempF',
        'sunHour', 'totalSnowCm', 'uvIndex',
        'description', 'sunrise', 'sunset',
    ],
    func: async (args) => {
        const location = requireString(args.location, 'location');
        const days = Number(args.days ?? 3);
        if (!Number.isInteger(days) || days < 1 || days > 3) {
            throw new ArgumentError('--days must be an integer between 1 and 3 (wttr.in caps the free-tier forecast at 3 days)');
        }
        const body = await wttrFetch(location, 'wttr forecast');
        const list = Array.isArray(body?.weather) ? body.weather : [];
        if (!list.length) {
            throw new EmptyResultError('wttr forecast', `wttr.in returned no forecast for "${location}".`);
        }
        return list.slice(0, days).map((day, i) => {
            // wttr.in's day-summary uses the noon hourly slot for "main" description.
            // Index 4 = 12:00 in their 3-hour-step hourly array.
            const noon = Array.isArray(day.hourly) && day.hourly[4] ? day.hourly[4] : day.hourly?.[0] ?? {};
            const astro = Array.isArray(day.astronomy) ? day.astronomy[0] : null;
            return {
                rank: i + 1,
                date: day.date ?? null,
                minTempC: day.mintempC != null ? Number(day.mintempC) : null,
                maxTempC: day.maxtempC != null ? Number(day.maxtempC) : null,
                avgTempC: day.avgtempC != null ? Number(day.avgtempC) : null,
                minTempF: day.mintempF != null ? Number(day.mintempF) : null,
                maxTempF: day.maxtempF != null ? Number(day.maxtempF) : null,
                avgTempF: day.avgtempF != null ? Number(day.avgtempF) : null,
                sunHour: day.sunHour != null ? Number(day.sunHour) : null,
                totalSnowCm: day.totalSnow_cm != null ? Number(day.totalSnow_cm) : null,
                uvIndex: day.uvIndex != null ? Number(day.uvIndex) : null,
                description: pickWeatherDesc(noon?.weatherDesc),
                sunrise: astro?.sunrise ?? null,
                sunset: astro?.sunset ?? null,
            };
        });
    },
});
