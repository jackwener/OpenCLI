// frankfurter historical — historical ECB FX rates for a single date or range.
//
// Endpoint: GET /v1/<date>?base=<base>&symbols=<csv>          (single day)
//           GET /v1/<from>..<to>?base=<base>&symbols=<csv>    (range)
//
// Single day: one row per target currency.
// Range: one row per (date, target) pair, newest-first.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    FRANKFURTER_BASE,
    frankfurterFetch,
    requireCurrency,
    requireDate,
    requireOptionalCurrency,
    requireOptionalDate,
} from './utils.js';

cli({
    site: 'frankfurter',
    name: 'historical',
    access: 'read',
    description: 'Historical ECB FX rates for a single date or date range',
    domain: 'api.frankfurter.dev',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'date', positional: true, required: true, help: 'Start date YYYY-MM-DD (or single day if --to omitted)' },
        { name: 'to', help: 'End date YYYY-MM-DD; if set, returns daily rates from <date> to <to>' },
        { name: 'base', default: 'EUR', help: 'Base currency (ISO 4217, default EUR)' },
        { name: 'symbols', help: 'Comma-separated target currencies (e.g. USD,JPY)' },
    ],
    columns: ['rank', 'date', 'base', 'target', 'rate'],
    func: async (args) => {
        const fromDate = requireDate(args.date, 'date');
        const toDate = requireOptionalDate(args.to, 'to');
        if (toDate && toDate < fromDate) {
            throw new ArgumentError('--to must be ≥ <date>');
        }
        const base = requireCurrency(args.base ?? 'EUR', 'base');
        let symbols = null;
        if (args.symbols != null && String(args.symbols).trim()) {
            symbols = String(args.symbols).split(',').map((s) => requireOptionalCurrency(s, 'symbols')).filter(Boolean);
        }
        const path = toDate ? `${fromDate}..${toDate}` : fromDate;
        const params = [`base=${base}`];
        if (symbols && symbols.length) params.push(`symbols=${symbols.join(',')}`);
        const url = `${FRANKFURTER_BASE}/${path}?${params.join('&')}`;
        const body = await frankfurterFetch(url, 'frankfurter historical');

        const out = [];
        if (toDate) {
            const ratesByDate = body && typeof body.rates === 'object' ? body.rates : null;
            if (!ratesByDate) {
                throw new EmptyResultError('frankfurter historical', 'frankfurter returned no rates.');
            }
            const dates = Object.keys(ratesByDate).sort().reverse();
            for (const d of dates) {
                const rates = ratesByDate[d];
                if (!rates || typeof rates !== 'object') continue;
                for (const [target, rate] of Object.entries(rates)) {
                    out.push({ rank: out.length + 1, date: d, base, target, rate: Number(rate) });
                }
            }
        } else {
            const rates = body && typeof body.rates === 'object' ? body.rates : null;
            if (!rates) {
                throw new EmptyResultError('frankfurter historical', 'frankfurter returned no rates.');
            }
            const date = String(body.date ?? fromDate);
            for (const [target, rate] of Object.entries(rates)) {
                out.push({ rank: out.length + 1, date, base, target, rate: Number(rate) });
            }
        }

        if (!out.length) {
            throw new EmptyResultError('frankfurter historical', 'frankfurter returned an empty rates map.');
        }
        return out;
    },
});
