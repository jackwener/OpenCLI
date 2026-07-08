import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './current.js';
import './forecast.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

const sampleBody = {
    current_condition: [{
        temp_C: '18', temp_F: '65', FeelsLikeC: '17', FeelsLikeF: '63',
        humidity: '70', cloudcover: '50', pressure: '1015', precipMM: '0.2',
        visibility: '10', uvIndex: '4', windspeedKmph: '12', winddir16Point: 'NE', winddirDegree: '45',
        weatherDesc: [{ value: 'Partly cloudy' }],
        localObsDateTime: '2026-05-06 10:00 AM',
    }],
    nearest_area: [{
        areaName: [{ value: 'Tokyo' }],
        country: [{ value: 'Japan' }],
        region: [{ value: 'Tokyo' }],
        latitude: '35.685', longitude: '139.752',
    }],
    weather: [
        {
            date: '2026-05-06', mintempC: '15', maxtempC: '22', avgtempC: '18',
            mintempF: '59', maxtempF: '72', avgtempF: '65',
            sunHour: '12.0', totalSnow_cm: '0.0', uvIndex: '4',
            astronomy: [{ sunrise: '04:50 AM', sunset: '06:35 PM' }],
            hourly: [
                {}, {}, {}, {},
                { weatherDesc: [{ value: 'Sunny' }] },
                {},
            ],
        },
    ],
};

describe('wttr current', () => {
    const cmd = getRegistry().get('wttr/current');

    it('rejects empty location', async () => {
        await expect(cmd.func({ location: '' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 404 to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('not found', { status: 404 })));
        await expect(cmd.func({ location: 'Atlantis' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('promotes non-JSON body to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('Unknown location', { status: 200 })));
        await expect(cmd.func({ location: 'asdf' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes current row + numeric coercion', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sampleBody), { status: 200 })));
        const rows = await cmd.func({ location: 'Tokyo' });
        expect(rows).toHaveLength(1);
        expect(rows[0].location).toBe('Tokyo');
        expect(rows[0].country).toBe('Japan');
        expect(rows[0].tempC).toBe(18);
        expect(rows[0].description).toBe('Partly cloudy');
        expect(rows[0].windDirection).toBe('NE');
    });
});

describe('wttr forecast', () => {
    const cmd = getRegistry().get('wttr/forecast');

    it('rejects --days out of range', async () => {
        await expect(cmd.func({ location: 'Tokyo', days: 5 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('shapes forecast rows + picks noon description', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sampleBody), { status: 200 })));
        const rows = await cmd.func({ location: 'Tokyo' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            rank: 1, date: '2026-05-06', minTempC: 15, maxTempC: 22, avgTempC: 18,
            description: 'Sunny', sunrise: '04:50 AM', sunset: '06:35 PM',
        });
    });
});
