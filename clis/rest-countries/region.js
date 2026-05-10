// rest-countries region — list every country in a region.
//
// Region values: africa / americas / asia / europe / oceania / antarctic.
// Subregions ("eastern asia") are not supported by this command — they go
// through the v3.1 `subregion/` endpoint which behaves identically.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    COUNTRY_FIELDS,
    REST_COUNTRIES_BASE,
    projectCountry,
    requireBoundedInt,
    requireRegion,
    restCountriesFetch,
} from './utils.js';

cli({
    site: 'rest-countries',
    name: 'region',
    access: 'read',
    description: 'List countries in a region (africa / americas / asia / europe / oceania / antarctic)',
    domain: 'restcountries.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'region', positional: true, required: true, help: 'Region name (case-insensitive)' },
        { name: 'limit', type: 'int', default: 250, help: 'Max rows (1-250)' },
    ],
    columns: [
        'rank',
        'commonName',
        'officialName',
        'cca2',
        'cca3',
        'ccn3',
        'capital',
        'region',
        'subregion',
        'population',
        'area',
        'languages',
        'currencies',
        'latitude',
        'longitude',
        'timezones',
        'independent',
        'unMember',
        'landlocked',
        'flag',
        'url',
    ],
    func: async (args) => {
        const region = requireRegion(args.region);
        const limit = requireBoundedInt(args.limit, 250, 250);
        const url = `${REST_COUNTRIES_BASE}/region/${encodeURIComponent(region)}?fields=${COUNTRY_FIELDS}`;
        const body = await restCountriesFetch(url, 'rest-countries region');
        const list = Array.isArray(body) ? body : [];
        if (!list.length) {
            throw new EmptyResultError('rest-countries region', `No countries returned for region "${region}".`);
        }
        const sorted = [...list].sort((a, b) => (b?.population ?? 0) - (a?.population ?? 0));
        return sorted.slice(0, limit).map((c, i) => ({ rank: i + 1, ...projectCountry(c) }));
    },
});
