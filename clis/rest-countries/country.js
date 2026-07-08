// rest-countries country — look up a country by common / official name.
//
// REST Countries' `name/<query>` endpoint matches as substring across both
// common and official names; multiple matches are returned (e.g. "guinea"
// matches Guinea, Guinea-Bissau, Equatorial Guinea, Papua New Guinea).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    COUNTRY_FIELDS,
    REST_COUNTRIES_BASE,
    projectCountry,
    requireBoundedInt,
    requireString,
    restCountriesFetch,
} from './utils.js';

cli({
    site: 'rest-countries',
    name: 'country',
    access: 'read',
    description: 'Look up countries by name (common / official, substring match)',
    domain: 'restcountries.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'Country name (e.g. "japan", "united kingdom")' },
        { name: 'limit', type: 'int', default: 25, help: 'Max rows (1-250)' },
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
        const name = requireString(args.name, 'name');
        const limit = requireBoundedInt(args.limit, 25, 250);
        const url = `${REST_COUNTRIES_BASE}/name/${encodeURIComponent(name)}?fields=${COUNTRY_FIELDS}`;
        const body = await restCountriesFetch(url, 'rest-countries country');
        const list = Array.isArray(body) ? body : [];
        if (!list.length) {
            throw new EmptyResultError('rest-countries country', `No countries matched "${name}".`);
        }
        // Sort by population descending so the most "expected" hit is first.
        const sorted = [...list].sort((a, b) => (b?.population ?? 0) - (a?.population ?? 0));
        return sorted.slice(0, limit).map((c, i) => ({ rank: i + 1, ...projectCountry(c) }));
    },
});
