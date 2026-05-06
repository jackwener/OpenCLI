import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './forecast.js';
import './alerts.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('nws forecast', () => {
    const cmd = getRegistry().get('nws/forecast');

    it('rejects bad coord format', async () => {
        await expect(cmd.func({ point: '37.77, San Francisco' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects out-of-range latitude', async () => {
        await expect(cmd.func({ point: '95.0,-122.4' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('chains points → forecast in two fetches', async () => {
        const pointResp = { properties: { forecast: 'https://api.weather.gov/gridpoints/MTR/85,105/forecast' } };
        const forecastResp = {
            properties: {
                periods: [
                    {
                        name: 'Tonight', startTime: '2026-05-06T18:00:00-07:00', endTime: '2026-05-07T06:00:00-07:00',
                        isDaytime: false, temperature: 52, temperatureUnit: 'F',
                        windSpeed: '5 to 10 mph', windDirection: 'W',
                        shortForecast: 'Mostly Clear', detailedForecast: 'Mostly clear, with a low around 52.',
                        probabilityOfPrecipitation: { value: 10 },
                    },
                ],
            },
        };
        let call = 0;
        global.fetch = vi.fn(() => {
            call += 1;
            if (call === 1) return Promise.resolve(new Response(JSON.stringify(pointResp), { status: 200 }));
            return Promise.resolve(new Response(JSON.stringify(forecastResp), { status: 200 }));
        });
        const rows = await cmd.func({ point: '37.7749,-122.4194' });
        expect(call).toBe(2);
        expect(rows[0].name).toBe('Tonight');
        expect(rows[0].temperature).toBe(52);
        expect(rows[0].precipitationProbability).toBe(10);
    });

    it('promotes missing forecast url to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ properties: {} }), { status: 200 })));
        await expect(cmd.func({ point: '0.0,0.0' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('nws alerts', () => {
    const cmd = getRegistry().get('nws/alerts');

    it('rejects bad state', async () => {
        await expect(cmd.func({ state: 'cal' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects --limit > 500', async () => {
        await expect(cmd.func({ limit: 5000 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('shapes an alert row + handles areaDesc', async () => {
        const sample = {
            features: [{
                id: 'urn:oid:2.49.0.1.840.0.123',
                properties: {
                    event: 'Heat Advisory', severity: 'Moderate', urgency: 'Expected', certainty: 'Likely',
                    headline: 'Heat Advisory issued May 6 at 3:00 PM PDT',
                    areaDesc: 'Central Sacramento Valley; San Joaquin Valley',
                    sent: '2026-05-06T22:00:00Z', effective: '2026-05-06T22:00:00Z', expires: '2026-05-08T03:00:00Z',
                    senderName: 'NWS Sacramento CA',
                    description: 'Temperatures up to 105.',
                    '@id': 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.123',
                },
            }],
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ state: 'CA' });
        expect(rows[0].event).toBe('Heat Advisory');
        expect(rows[0].severity).toBe('Moderate');
        expect(rows[0].areaDesc).toContain('Sacramento');
    });
});
