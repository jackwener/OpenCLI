// disease-sh global — worldwide COVID-19 totals.
//
// Endpoint: GET /v3/covid-19/all
//
// Single-row response with global cumulative + daily-delta + per-million stats.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { DISEASE_BASE, diseaseFetch, projectStats } from './utils.js';

cli({
    site: 'disease-sh',
    name: 'global',
    access: 'read',
    description: 'Worldwide COVID-19 totals (cases, deaths, tests, per-million)',
    domain: 'disease.sh',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: [
        'updated', 'cases', 'todayCases', 'deaths', 'todayDeaths',
        'recovered', 'active', 'critical', 'casesPerMillion', 'deathsPerMillion',
        'tests', 'population', 'affectedCountries',
    ],
    func: async () => {
        const url = `${DISEASE_BASE}/all`;
        const body = await diseaseFetch(url, 'disease-sh global');
        if (!body || typeof body !== 'object' || body.cases == null) {
            throw new EmptyResultError('disease-sh global', 'disease.sh returned no global stats.');
        }
        const updated = body.updated != null ? new Date(Number(body.updated)).toISOString() : '';
        return [{
            updated,
            ...projectStats(body),
            affectedCountries: Number(body.affectedCountries ?? 0),
        }];
    },
});
