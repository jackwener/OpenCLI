import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './geocode.js';
import './forecast.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('open-meteo geocode adapter', () => {
    const cmd = getRegistry().get('open-meteo/geocode');

    it('rejects empty / oversized queries before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ name: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ name: 'foo', limit: 999 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ name: 'tokyo' })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when results array is missing', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));
        await expect(cmd.func({ name: 'zzz-nowhere' })).rejects.toThrow(EmptyResultError);
    });

    it('round-trips lat/lon into forecast-ready row shape', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            results: [{
                id: 1850147,
                name: 'Tokyo',
                country: 'Japan',
                admin1: 'Tokyo',
                latitude: 35.6895,
                longitude: 139.69171,
                elevation: 44,
                population: 9733276,
                timezone: 'Asia/Tokyo',
                feature_code: 'PPLC',
            }],
        }), { status: 200 })));

        const rows = await cmd.func({ name: 'tokyo', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1,
            id: 1850147,
            name: 'Tokyo',
            latitude: 35.6895,
            longitude: 139.69171,
            country: 'Japan',
        });
    });
});

describe('open-meteo forecast adapter', () => {
    const cmd = getRegistry().get('open-meteo/forecast');

    it('rejects out-of-range lat/lon and bad days before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ latitude: 999, longitude: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ latitude: 0, longitude: 999 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ latitude: 0, longitude: 0, days: 99 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ latitude: 'NaN', longitude: 0 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 400 (Open-Meteo bad params) to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
            JSON.stringify({ reason: 'No data is available' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
        )));
        await expect(cmd.func({ latitude: 0, longitude: 0, days: 3 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when daily.time is empty', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            daily: { time: [] }, daily_units: {},
        }), { status: 200 })));
        await expect(cmd.func({ latitude: 35.6895, longitude: 139.69171, days: 3 })).rejects.toThrow(EmptyResultError);
    });

    it('decodes WMO weather codes and projects daily fields without silent clamp', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            daily: {
                time: ['2026-05-06', '2026-05-07'],
                weather_code: [51, 95],
                temperature_2m_max: [20.1, 24.8],
                temperature_2m_min: [12.2, 14.2],
                apparent_temperature_max: [20.3, 28.4],
                apparent_temperature_min: [11.5, 15.0],
                sunrise: ['2026-05-06T04:44', '2026-05-07T04:43'],
                sunset: ['2026-05-06T18:31', '2026-05-07T18:32'],
                precipitation_sum: [0.6, 0],
                precipitation_hours: [2, 0],
                precipitation_probability_max: [43, 41],
                wind_speed_10m_max: [8.4, 9.8],
                wind_gusts_10m_max: [37.1, 28.4],
                uv_index_max: [5.95, 7.95],
            },
            daily_units: {
                temperature_2m_max: '°C',
                precipitation_sum: 'mm',
                wind_speed_10m_max: 'km/h',
            },
        }), { status: 200 })));

        const rows = await cmd.func({ latitude: 35.6895, longitude: 139.69171, days: 2 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            date: '2026-05-06',
            weatherCode: 51,
            weather: 'Drizzle: light',
            tempMax: 20.1,
            tempUnit: '°C',
        });
        expect(rows[1]).toMatchObject({
            weatherCode: 95,
            weather: 'Thunderstorm: slight or moderate',
        });
    });
});
