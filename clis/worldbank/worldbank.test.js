import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './country.js';
import './indicator.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('worldbank country', () => {
    const cmd = getRegistry().get('worldbank/country');

    it('rejects bad country code', async () => {
        await expect(cmd.func({ country: 'usaa' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes message-only response to EmptyResultError', async () => {
        const sample = [{ message: [{ id: '120', value: 'Invalid value' }] }];
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        await expect(cmd.func({ country: 'XX' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes a country profile row', async () => {
        const sample = [{ page: 1, pages: 1, per_page: 50, total: 1 }, [{
            id: 'JPN', iso2Code: 'JP', name: 'Japan',
            region: { value: 'East Asia & Pacific' },
            incomeLevel: { value: 'High income' },
            lendingType: { value: 'Not classified' },
            capitalCity: 'Tokyo', longitude: '139.7700', latitude: '35.6700',
        }]];
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ country: 'JPN' });
        expect(rows[0].iso3).toBe('JPN');
        expect(rows[0].iso2).toBe('JP');
        expect(rows[0].capital).toBe('Tokyo');
        expect(rows[0].latitude).toBeCloseTo(35.67);
    });
});

describe('worldbank indicator', () => {
    const cmd = getRegistry().get('worldbank/indicator');

    it('rejects bad indicator', async () => {
        await expect(cmd.func({ country: 'JP', indicator: 'gdp!' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects malformed --years', async () => {
        await expect(cmd.func({ country: 'JP', indicator: 'NY.GDP.MKTP.CD', years: '2000-2020' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('shapes a time-series row', async () => {
        const sample = [{ page: 1, pages: 1, per_page: 50, total: 2 }, [
            {
                indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' },
                country: { id: 'JP', value: 'Japan' },
                countryiso3code: 'JPN', date: '2024', value: 4.21e12, unit: '',
            },
            {
                indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' },
                country: { id: 'JP', value: 'Japan' },
                countryiso3code: 'JPN', date: '2023', value: 4.20e12, unit: '',
            },
        ]];
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ country: 'JP', indicator: 'NY.GDP.MKTP.CD' });
        expect(rows).toHaveLength(2);
        expect(rows[0].date).toBe('2024');
        expect(rows[0].value).toBe(4.21e12);
        expect(rows[0].indicatorCode).toBe('NY.GDP.MKTP.CD');
    });
});
