// openfda food-recall — FDA food enforcement (recalls, market withdrawals, alerts).
//
// Endpoint: GET /food/enforcement.json?search=<lucene>&limit=<n>
// Sorted by report_date descending (most recent first).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { OPENFDA_BASE, openfdaFetch, requireBoundedInt } from './utils.js';

cli({
    site: 'openfda',
    name: 'food-recall',
    access: 'read',
    description: 'FDA food recall and enforcement actions (most recent first)',
    domain: 'fda.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', help: 'Free-text Lucene query (e.g. "salmonella", "listeria"); default: all recent recalls' },
        { name: 'status', help: 'Filter by status: "Ongoing", "Completed", "Terminated"' },
        { name: 'classification', help: 'Filter by class: "Class I" (most serious), "Class II", "Class III"' },
        { name: 'limit', type: 'int', default: 10, help: 'Max rows (1-100, default 10; openFDA caps anonymous tier at 100/page)' },
    ],
    columns: [
        'rank', 'recallNumber', 'status', 'classification', 'voluntary',
        'recallingFirm', 'city', 'state', 'country',
        'productDescription', 'reasonForRecall', 'productQuantity',
        'distributionPattern', 'reportDate', 'recallInitiationDate', 'terminationDate',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 10, 100);
        const filters = [];
        if (args.query) filters.push(String(args.query).trim());
        if (args.status) filters.push(`status:"${String(args.status).trim()}"`);
        if (args.classification) filters.push(`classification:"${String(args.classification).trim()}"`);
        // URLSearchParams percent-encodes the `+AND+` separator that openFDA's
        // Lucene parser treats specially, so build the query string by hand.
        const qs = filters.length
            ? `search=${filters.map(f => encodeURIComponent(f)).join('+AND+')}&limit=${limit}`
            : `limit=${limit}`;
        const url = `${OPENFDA_BASE}/food/enforcement.json?${qs}`;
        const body = await openfdaFetch(url, 'openfda food-recall');
        const list = Array.isArray(body?.results) ? body.results : [];
        if (!list.length) {
            throw new EmptyResultError('openfda food-recall', 'openFDA returned no food recall records matching the filter.');
        }
        return list.map((r, i) => ({
            rank: i + 1,
            recallNumber: r?.recall_number ?? null,
            status: r?.status ?? null,
            classification: r?.classification ?? null,
            voluntary: r?.voluntary_mandated ?? null,
            recallingFirm: r?.recalling_firm ?? null,
            city: r?.city ?? null,
            state: r?.state ?? null,
            country: r?.country ?? null,
            productDescription: r?.product_description ?? null,
            reasonForRecall: r?.reason_for_recall ?? null,
            productQuantity: r?.product_quantity ?? null,
            distributionPattern: r?.distribution_pattern ?? null,
            reportDate: r?.report_date ?? null,
            recallInitiationDate: r?.recall_initiation_date ?? null,
            terminationDate: r?.termination_date ?? null,
        }));
    },
});
