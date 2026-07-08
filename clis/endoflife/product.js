// endoflife product — release cycles + EOL / support dates for one product.
//
// Hits `https://endoflife.date/api/<product>.json`. Returns one row per cycle
// (newest first), with the latest version, release / EOL / LTS / support dates,
// and an `eolStatus` projection (`active` / `eol` / `ongoing`) so agents can
// answer "is this version still supported" without parsing dates themselves.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { EOL_BASE, eolFetch, normaliseDateOrFlag, requireProduct } from './utils.js';

cli({
    site: 'endoflife',
    name: 'product',
    access: 'read',
    description: 'Release cycles + EOL / LTS / support dates for one product on endoflife.date',
    domain: 'endoflife.date',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'product', positional: true, type: 'string', required: true, help: 'endoflife.date product slug (e.g. "nodejs", "python", "ubuntu")' },
    ],
    columns: [
        'product', 'cycle', 'releaseDate', 'latest', 'latestReleaseDate',
        'lts', 'support', 'eol', 'extendedSupport', 'eolStatus', 'url',
    ],
    func: async (args) => {
        const product = requireProduct(args.product);
        const cycles = await eolFetch(`${EOL_BASE}/${encodeURIComponent(product)}.json`, `endoflife product ${product}`);
        if (!Array.isArray(cycles) || cycles.length === 0) {
            throw new EmptyResultError('endoflife product', `endoflife.date returned no cycles for "${product}".`);
        }
        const today = new Date().toISOString().slice(0, 10);
        return cycles.map((c) => {
            const eol = normaliseDateOrFlag(c?.eol);
            // eolStatus projection — best-effort, derived from eol vs today (not from a remote field).
            let eolStatus = null;
            if (eol === 'ongoing') eolStatus = 'ongoing';
            else if (typeof eol === 'string' && eol >= today) eolStatus = 'active';
            else if (typeof eol === 'string') eolStatus = 'eol';
            return {
                product,
                cycle: String(c?.cycle ?? '').trim(),
                releaseDate: typeof c?.releaseDate === 'string' ? c.releaseDate : null,
                latest: String(c?.latest ?? '').trim(),
                latestReleaseDate: typeof c?.latestReleaseDate === 'string' ? c.latestReleaseDate : null,
                lts: normaliseDateOrFlag(c?.lts),
                support: normaliseDateOrFlag(c?.support),
                eol,
                extendedSupport: normaliseDateOrFlag(c?.extendedSupport),
                eolStatus,
                url: `https://endoflife.date/${product}`,
            };
        });
    },
});
