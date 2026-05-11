/**
 * dblp publication search.
 *
 * Calls the public `search/publ/api?q=&format=json&h=` endpoint. dblp
 * doesn't expose abstracts via the search API, so the row schema mirrors
 * what's actually addressable: canonical record `key`, title, authors,
 * venue / year / type, DOI, and the open-access landing page when one
 * exists.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    SEARCH_COLUMNS,
    dblpFetchJson,
    requireBoundedInt,
    requireQuery,
    searchHitToRow,
} from './utils.js';

cli({
    site: 'dblp',
    name: 'search',
    access: 'read',
    description: 'Search dblp computer-science bibliography by free-text query',
    domain: 'dblp.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (title / author / venue, e.g. "attention is all you need")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100, single dblp page)' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (args) => {
        const query = requireQuery(args.query);
        const limit = requireBoundedInt(args.limit, 20, 100);
        const path = `/search/publ/api?q=${encodeURIComponent(query)}&format=json&h=${limit}`;
        const json = await dblpFetchJson(path, 'dblp search');
        const hits = json?.result?.hits?.hit;
        const list = Array.isArray(hits) ? hits : [];
        if (list.length === 0) {
            throw new EmptyResultError('dblp search', `No publications matched "${query}".`);
        }
        return list.slice(0, limit).map((hit, i) => searchHitToRow(hit, i + 1));
    },
});
