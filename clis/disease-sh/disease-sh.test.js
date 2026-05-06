import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './global.js';
import './country.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('disease-sh global', () => {
    const cmd = getRegistry().get('disease-sh/global');

    it('shapes a global row + converts updated ms→ISO', async () => {
        const sample = {
            updated: 1746500000000, cases: 700e6, todayCases: 1234, deaths: 7e6, todayDeaths: 100,
            recovered: 690e6, active: 3e6, critical: 5000, casesPerOneMillion: 89000, deathsPerOneMillion: 900,
            tests: 7e9, population: 7800e6, affectedCountries: 230,
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({});
        expect(rows[0].cases).toBe(700e6);
        expect(rows[0].affectedCountries).toBe(230);
        expect(rows[0].updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('promotes empty/missing body to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('disease-sh country', () => {
    const cmd = getRegistry().get('disease-sh/country');

    it('rejects empty country', async () => {
        await expect(cmd.func({ country: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 404 to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('Not Found', { status: 404 })));
        await expect(cmd.func({ country: 'Atlantis' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes a country row + extracts iso2/iso3/flag', async () => {
        const sample = {
            country: 'Japan', countryInfo: { iso2: 'JP', iso3: 'JPN', flag: 'https://flags/jp.png' },
            continent: 'Asia', updated: 1746500000000,
            cases: 33500000, todayCases: 50, deaths: 75000, todayDeaths: 5,
            recovered: 33000000, active: 100000, critical: 50,
            casesPerOneMillion: 270000, deathsPerOneMillion: 600, tests: 100000000, population: 124000000,
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ country: 'JP' });
        expect(rows[0].country).toBe('Japan');
        expect(rows[0].iso2).toBe('JP');
        expect(rows[0].iso3).toBe('JPN');
        expect(rows[0].continent).toBe('Asia');
        expect(rows[0].cases).toBe(33500000);
    });
});
