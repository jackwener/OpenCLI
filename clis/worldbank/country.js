// worldbank country — country profile (region, income group, capital, etc).
//
// Endpoint: GET /v2/country/<iso>?format=json
//
// Single-row response. Round-trips into `worldbank indicator --country <iso>`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { WB_BASE, wbFetch, requireCountry } from './utils.js';

cli({
    site: 'worldbank',
    name: 'country',
    access: 'read',
    description: 'World Bank country profile (region, income group, capital, lat/lon)',
    domain: 'api.worldbank.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'country', positional: true, required: true, help: 'ISO country code (alpha-2 or alpha-3)' },
    ],
    columns: [
        'iso2', 'iso3', 'name', 'region', 'incomeLevel', 'lendingType',
        'capital', 'longitude', 'latitude',
    ],
    func: async (args) => {
        const country = requireCountry(args.country, 'country');
        const url = `${WB_BASE}/country/${country}?format=json`;
        const { results } = await wbFetch(url, 'worldbank country');
        if (!results.length) {
            throw new EmptyResultError('worldbank country', `World Bank has no record for "${country}".`);
        }
        const c = results[0];
        return [{
            iso2: String(c.iso2Code ?? '').trim(),
            iso3: String(c.id ?? '').trim(),
            name: String(c.name ?? '').trim(),
            region: String(c.region?.value ?? '').trim(),
            incomeLevel: String(c.incomeLevel?.value ?? '').trim(),
            lendingType: String(c.lendingType?.value ?? '').trim(),
            capital: String(c.capitalCity ?? '').trim(),
            longitude: c.longitude !== '' && c.longitude != null ? Number(c.longitude) : null,
            latitude: c.latitude !== '' && c.latitude != null ? Number(c.latitude) : null,
        }];
    },
});
