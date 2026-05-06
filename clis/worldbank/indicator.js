// worldbank indicator — time series for a country + indicator.
//
// Endpoint: GET /v2/country/<iso>/indicator/<indicator>?format=json&per_page=<N>&date=<YYYY:YYYY>
//
// Returns one row per (country, year) data point, newest year first. Pinned
// `per_page` is enough to capture decades of annual data.
//
// Common indicators:
//   NY.GDP.MKTP.CD          — GDP (current US$)
//   SP.POP.TOTL              — Population, total
//   FP.CPI.TOTL.ZG           — Inflation, consumer prices (annual %)
//   SL.UEM.TOTL.ZS           — Unemployment, total (% of labor force)
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { WB_BASE, wbFetch, requireCountry, requireIndicator } from './utils.js';

cli({
    site: 'worldbank',
    name: 'indicator',
    access: 'read',
    description: 'World Bank indicator time series for a country',
    domain: 'api.worldbank.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'country', required: true, help: 'ISO country code (alpha-2 or alpha-3)' },
        { name: 'indicator', required: true, help: 'World Bank indicator code (e.g. NY.GDP.MKTP.CD)' },
        { name: 'years', help: 'Year range YYYY:YYYY (e.g. 2000:2024)' },
        { name: 'limit', type: 'int', default: 50, help: 'Max data points (1-500, default 50)' },
    ],
    columns: ['rank', 'country', 'iso3', 'indicator', 'indicatorCode', 'date', 'value', 'unit'],
    func: async (args) => {
        const country = requireCountry(args.country, 'country');
        const indicator = requireIndicator(args.indicator, 'indicator');
        const limit = Number(args.limit ?? 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
            throw new ArgumentError('--limit must be an integer between 1 and 500');
        }
        let yearsParam = '';
        if (args.years != null && String(args.years).trim()) {
            const y = String(args.years).trim();
            if (!/^\d{4}:\d{4}$/.test(y)) {
                throw new ArgumentError('--years must be in YYYY:YYYY form (e.g. 2000:2024)');
            }
            const [from, to] = y.split(':').map(Number);
            if (from > to) throw new ArgumentError('--years start must be ≤ end');
            yearsParam = `&date=${from}:${to}`;
        }
        const url = `${WB_BASE}/country/${country}/indicator/${indicator}?format=json&per_page=${limit}${yearsParam}`;
        const { results } = await wbFetch(url, 'worldbank indicator');
        if (!results.length) {
            throw new EmptyResultError('worldbank indicator', `No data points for ${country} / ${indicator}.`);
        }
        return results.slice(0, limit).map((d, i) => ({
            rank: i + 1,
            country: String(d.country?.value ?? '').trim(),
            iso3: String(d.country?.id ?? d.countryiso3code ?? '').trim(),
            indicator: String(d.indicator?.value ?? '').trim(),
            indicatorCode: String(d.indicator?.id ?? indicator).trim(),
            date: String(d.date ?? '').trim(),
            value: d.value != null ? Number(d.value) : null,
            unit: String(d.unit ?? '').trim(),
        }));
    },
});
