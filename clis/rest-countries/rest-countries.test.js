import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './country.js';
import './region.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('rest-countries country adapter', () => {
    const cmd = getRegistry().get('rest-countries/country');

    it('round-trips cca3 from row into restcountries.com alpha URL', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
            {
                name: { common: 'Japan', official: 'Japan' },
                cca2: 'JP', cca3: 'JPN', ccn3: '392',
                capital: ['Tokyo'],
                region: 'Asia', subregion: 'Eastern Asia',
                population: 125000000, area: 377000,
                languages: { jpn: 'Japanese' },
                currencies: { JPY: { name: 'Japanese yen', symbol: '¥' } },
                latlng: [36, 138], timezones: ['UTC+09:00'], independent: true, unMember: true, landlocked: false, flag: '🇯🇵',
            },
        ]), { status: 200 })));
        const rows = await cmd.func({ name: 'japan', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1, commonName: 'Japan', cca2: 'JP', cca3: 'JPN',
            capital: 'Tokyo', region: 'Asia',
            languages: 'Japanese', currencies: 'JPY (Japanese yen)',
            latitude: 36, longitude: 138,
            url: 'https://restcountries.com/v3.1/alpha/jpn',
        });
    });
});
