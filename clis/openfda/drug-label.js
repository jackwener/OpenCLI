// openfda drug-label — FDA-approved drug label search.
//
// Endpoint: GET /drug/label.json?search=<lucene>&limit=<n>
// Default search field is brand_name OR generic_name (Lucene syntax via openfda
// query DSL). Returns label sections (purpose, warnings, dosage, etc.) and
// metadata (manufacturer, product_ndc, route, etc.).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    OPENFDA_BASE,
    firstOrNull,
    joinOrNull,
    openfdaFetch,
    requireBoundedInt,
    requireString,
} from './utils.js';

cli({
    site: 'openfda',
    name: 'drug-label',
    access: 'read',
    description: 'Search FDA-approved drug labels (brand or generic name)',
    domain: 'fda.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Brand or generic drug name (e.g. "aspirin", "lisinopril")' },
        { name: 'limit', type: 'int', default: 5, help: 'Max rows (1-25, default 5; openFDA caps anonymous tier at 25/page)' },
    ],
    columns: [
        'rank', 'id', 'brandName', 'genericName', 'manufacturer',
        'productType', 'route', 'productNdc', 'pharmClass',
        'purpose', 'indications', 'warnings', 'dosage', 'effectiveTime',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 5, 25);
        const brand = `openfda.brand_name:"${query}"`;
        const generic = `openfda.generic_name:"${query}"`;
        // URLSearchParams encodes spaces/operators in ways openFDA's Lucene
        // parser handles poorly. Keep the OR literal visible and encode only
        // each clause, matching food-recall's manual +AND+ handling.
        const search = `${encodeURIComponent(brand)}+OR+${encodeURIComponent(generic)}`;
        const url = `${OPENFDA_BASE}/drug/label.json?search=${search}&limit=${limit}`;
        const body = await openfdaFetch(url, 'openfda drug-label');
        const list = Array.isArray(body?.results) ? body.results : [];
        if (!list.length) {
            throw new EmptyResultError('openfda drug-label', `openFDA returned no labels matching "${query}".`);
        }
        return list.map((r, i) => {
            const o = r?.openfda ?? {};
            // pharm_class fields: epc (established pharmacologic class) is the
            // most user-meaningful — fall back through moa/cs/pe in that order.
            const pharmClass = firstOrNull(o.pharm_class_epc) ?? firstOrNull(o.pharm_class_moa)
                ?? firstOrNull(o.pharm_class_cs) ?? firstOrNull(o.pharm_class_pe);
            return {
                rank: i + 1,
                id: r?.id ?? null,
                brandName: firstOrNull(o.brand_name),
                genericName: firstOrNull(o.generic_name),
                manufacturer: firstOrNull(o.manufacturer_name),
                productType: firstOrNull(o.product_type),
                route: joinOrNull(o.route),
                productNdc: firstOrNull(o.product_ndc),
                pharmClass,
                purpose: firstOrNull(r.purpose),
                indications: firstOrNull(r.indications_and_usage),
                warnings: firstOrNull(r.warnings),
                dosage: firstOrNull(r.dosage_and_administration),
                effectiveTime: r?.effective_time ?? null,
            };
        });
    },
});
