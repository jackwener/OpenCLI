// oeis search — keyword / pattern search against the OEIS index.
//
// OEIS' search supports both natural-language queries ("fibonacci") and
// numeric pattern queries ("1,1,2,3,5,8"). Returns up to 10 results per
// page; we honor `--limit` by paginating via `&start=`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { OEIS_BASE, formatId, oeisFetch, previewTerms, requireBoundedInt, requireString } from './utils.js';

cli({
    site: 'oeis',
    name: 'search',
    access: 'read',
    description: 'Search OEIS sequences by keyword or numeric pattern',
    domain: 'oeis.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword or comma-separated terms (e.g. "fibonacci", "1,1,2,3,5,8")' },
        { name: 'limit', type: 'int', default: 10, help: 'Max sequences (1-100)' },
    ],
    columns: ['rank', 'id', 'name', 'keywords', 'preview', 'author', 'created', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 10, 100);
        // OEIS returns 10 per page; paginate via `&start=` until we have `limit` rows
        // or run out of pages. No silent clamp — if upstream has fewer results, surface
        // every row that came back.
        const collected = [];
        let start = 0;
        const pageSize = 10;
        // Cap iterations defensively at limit/pageSize + 1 so we never spin forever.
        const maxPages = Math.ceil(limit / pageSize) + 1;
        for (let page = 0; page < maxPages && collected.length < limit; page++) {
            const url = `${OEIS_BASE}/search?q=${encodeURIComponent(query)}&fmt=json&start=${start}`;
            const body = await oeisFetch(url, 'oeis search');
            const list = Array.isArray(body) ? body : [];
            if (!list.length) break;
            for (const r of list) {
                if (collected.length >= limit) break;
                collected.push(r);
            }
            if (list.length < pageSize) break;
            start += pageSize;
        }
        if (!collected.length) {
            throw new EmptyResultError('oeis search', `No OEIS sequences matched "${query}".`);
        }
        return collected.map((r, i) => {
            const id = formatId(r?.number);
            return {
                rank: i + 1,
                id,
                name: typeof r?.name === 'string' ? r.name : null,
                keywords: typeof r?.keyword === 'string' ? r.keyword : null,
                preview: previewTerms(r?.data),
                author: typeof r?.author === 'string' ? r.author : null,
                created: typeof r?.created === 'string' ? r.created : null,
                url: id ? `${OEIS_BASE}/${id}` : '',
            };
        });
    },
});
