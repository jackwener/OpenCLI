// frankfurter latest — latest exchange rates from ECB (frankfurter.app).
//
// Endpoint: GET /v1/latest?base=<base>&symbols=<csv>
//
// Returns one row per target currency with the rate against `--base`.
// Default base is EUR (ECB convention). Optional `--symbols` narrows to
// a comma-separated list of target codes; otherwise every supported
// currency is returned.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    FRANKFURTER_BASE,
    frankfurterFetch,
    requireCurrency,
    requireOptionalCurrency,
} from './utils.js';

cli({
    site: 'frankfurter',
    name: 'latest',
    access: 'read',
    description: 'Latest ECB-published FX rates against a base currency',
    domain: 'api.frankfurter.dev',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'base', default: 'EUR', help: 'Base currency (ISO 4217, default EUR)' },
        { name: 'symbols', help: 'Comma-separated target currencies (e.g. USD,JPY,GBP); default: all' },
    ],
    columns: ['rank', 'base', 'target', 'rate', 'date'],
    func: async (args) => {
        const base = requireCurrency(args.base ?? 'EUR', 'base');
        let symbols = null;
        if (args.symbols != null && String(args.symbols).trim()) {
            symbols = String(args.symbols).split(',').map((s) => requireOptionalCurrency(s, 'symbols')).filter(Boolean);
        }
        const params = [`base=${base}`];
        if (symbols && symbols.length) params.push(`symbols=${symbols.join(',')}`);
        const url = `${FRANKFURTER_BASE}/latest?${params.join('&')}`;
        const body = await frankfurterFetch(url, 'frankfurter latest');
        const rates = body && typeof body.rates === 'object' ? body.rates : null;
        if (!rates) {
            throw new EmptyResultError('frankfurter latest', 'frankfurter returned no rates.');
        }
        const date = String(body.date ?? '').trim();
        const entries = Object.entries(rates);
        if (!entries.length) {
            throw new EmptyResultError('frankfurter latest', 'frankfurter returned an empty rates map.');
        }
        return entries.map(([target, rate], i) => ({
            rank: i + 1,
            base,
            target,
            rate: Number(rate),
            date,
        }));
    },
});
