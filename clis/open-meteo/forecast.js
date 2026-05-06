// open-meteo forecast — daily weather forecast for a lat/lon pair.
//
// Hits `https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&daily=…`.
// Returns one row per forecast day with high/low temp, precipitation hours +
// probability, weather code, sunrise / sunset, wind max. Lat/lon round-trips
// from `open-meteo geocode`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { FORECAST_BASE, meteoFetch, requireBoundedInt, requireFloat } from './utils.js';

const DAILY_FIELDS = [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'apparent_temperature_max',
    'apparent_temperature_min',
    'sunrise',
    'sunset',
    'precipitation_sum',
    'precipitation_hours',
    'precipitation_probability_max',
    'wind_speed_10m_max',
    'wind_gusts_10m_max',
    'uv_index_max',
];

// Open-Meteo's WMO weather code → human label. Source:
// https://open-meteo.com/en/docs#weather_variable_documentation. Provided here
// so agents can show a readable value next to the raw code.
const WMO_CODES = new Map([
    [0, 'Clear sky'], [1, 'Mainly clear'], [2, 'Partly cloudy'], [3, 'Overcast'],
    [45, 'Fog'], [48, 'Depositing rime fog'],
    [51, 'Drizzle: light'], [53, 'Drizzle: moderate'], [55, 'Drizzle: dense'],
    [56, 'Freezing drizzle: light'], [57, 'Freezing drizzle: dense'],
    [61, 'Rain: slight'], [63, 'Rain: moderate'], [65, 'Rain: heavy'],
    [66, 'Freezing rain: light'], [67, 'Freezing rain: heavy'],
    [71, 'Snow fall: slight'], [73, 'Snow fall: moderate'], [75, 'Snow fall: heavy'],
    [77, 'Snow grains'],
    [80, 'Rain showers: slight'], [81, 'Rain showers: moderate'], [82, 'Rain showers: violent'],
    [85, 'Snow showers: slight'], [86, 'Snow showers: heavy'],
    [95, 'Thunderstorm: slight or moderate'],
    [96, 'Thunderstorm with slight hail'], [99, 'Thunderstorm with heavy hail'],
]);

function buildRow(daily, idx, units) {
    function pick(key) {
        const arr = daily?.[key];
        return Array.isArray(arr) && idx < arr.length ? arr[idx] : null;
    }
    const code = pick('weather_code');
    return {
        date: typeof daily?.time?.[idx] === 'string' ? daily.time[idx] : null,
        weatherCode: typeof code === 'number' ? code : null,
        weather: typeof code === 'number' && WMO_CODES.has(code) ? WMO_CODES.get(code) : null,
        tempMax: pick('temperature_2m_max'),
        tempMin: pick('temperature_2m_min'),
        apparentMax: pick('apparent_temperature_max'),
        apparentMin: pick('apparent_temperature_min'),
        sunrise: pick('sunrise'),
        sunset: pick('sunset'),
        precipSum: pick('precipitation_sum'),
        precipHours: pick('precipitation_hours'),
        precipProbabilityMax: pick('precipitation_probability_max'),
        windMax: pick('wind_speed_10m_max'),
        windGustMax: pick('wind_gusts_10m_max'),
        uvIndexMax: pick('uv_index_max'),
        tempUnit: units?.temperature_2m_max ?? null,
        precipUnit: units?.precipitation_sum ?? null,
        windUnit: units?.wind_speed_10m_max ?? null,
    };
}

cli({
    site: 'open-meteo',
    name: 'forecast',
    access: 'read',
    description: 'Daily weather forecast for a lat/lon pair (no API key required)',
    domain: 'api.open-meteo.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'latitude', positional: true, required: true, help: 'Latitude in decimal degrees (-90 to 90)' },
        { name: 'longitude', positional: true, required: true, help: 'Longitude in decimal degrees (-180 to 180)' },
        { name: 'days', type: 'int', default: 7, help: 'Forecast days (1-16)' },
    ],
    columns: [
        'date', 'weatherCode', 'weather', 'tempMax', 'tempMin', 'apparentMax',
        'apparentMin', 'sunrise', 'sunset', 'precipSum', 'precipHours',
        'precipProbabilityMax', 'windMax', 'windGustMax', 'uvIndexMax',
        'tempUnit', 'precipUnit', 'windUnit',
    ],
    func: async (args) => {
        const lat = requireFloat(args.latitude, 'latitude', { min: -90, max: 90 });
        const lon = requireFloat(args.longitude, 'longitude', { min: -180, max: 180 });
        const days = requireBoundedInt(args.days, 7, 16, 'days');
        const params = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            daily: DAILY_FIELDS.join(','),
            forecast_days: String(days),
            timezone: 'auto',
        });
        const url = `${FORECAST_BASE}/forecast?${params}`;
        const body = await meteoFetch(url, 'open-meteo forecast');
        const daily = body?.daily;
        const dailyUnits = body?.daily_units || {};
        const times = Array.isArray(daily?.time) ? daily.time : [];
        if (!times.length) {
            throw new EmptyResultError('open-meteo forecast', `Open-Meteo returned no daily data for (${lat}, ${lon}).`);
        }
        // Open-Meteo honors `forecast_days` server-side; if the response length
        // differs from what we asked for, surface every row (no silent clamp).
        const rows = [];
        for (let i = 0; i < times.length; i++) rows.push(buildRow(daily, i, dailyUnits));
        return rows;
    },
});
