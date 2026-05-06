// disease-sh country — COVID-19 totals for one country.
//
// Endpoint: GET /v3/covid-19/countries/<country>?strict=true
//
// Returns a single row keyed by country (accepts ISO2/ISO3/full name).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { DISEASE_BASE, diseaseFetch, projectStats, requireString } from './utils.js';

cli({
    site: 'disease-sh',
    name: 'country',
    access: 'read',
    description: 'COVID-19 totals for a country (ISO2 / ISO3 / full name)',
    domain: 'disease.sh',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'country', positional: true, required: true, help: 'Country: ISO2 (US), ISO3 (USA), or full name' },
    ],
    columns: [
        'country', 'iso2', 'iso3', 'continent', 'updated', 'cases', 'todayCases',
        'deaths', 'todayDeaths', 'recovered', 'active', 'critical',
        'casesPerMillion', 'deathsPerMillion', 'tests', 'population', 'flag',
    ],
    func: async (args) => {
        const country = requireString(args.country, 'country');
        const url = `${DISEASE_BASE}/countries/${encodeURIComponent(country)}?strict=false`;
        const body = await diseaseFetch(url, 'disease-sh country');
        if (!body || typeof body !== 'object' || body.cases == null) {
            throw new EmptyResultError('disease-sh country', `disease.sh returned no stats for "${country}".`);
        }
        const info = body.countryInfo && typeof body.countryInfo === 'object' ? body.countryInfo : {};
        const updated = body.updated != null ? new Date(Number(body.updated)).toISOString() : '';
        return [{
            country: String(body.country ?? country),
            iso2: String(info.iso2 ?? '').trim(),
            iso3: String(info.iso3 ?? '').trim(),
            continent: String(body.continent ?? '').trim(),
            updated,
            ...projectStats(body),
            flag: String(info.flag ?? '').trim(),
        }];
    },
});
