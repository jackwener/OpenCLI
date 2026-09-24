// nodeseek search — full-text search over NodeSeek posts.
//
// Results are server-rendered as `.post-list-item` (same shape as the home /
// category feed, 50 per page, `&page=N` server-side pagination), so scraping,
// paging, and finalizing are shared with `latest` via client.js.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { requireNonEmptyQuery } from '../_shared/common.js';
import { collectPaged, ensureNsHome, hasNsSessionCookie, readLimit, NS_HOME, scrapePostList, finalizeListRows } from './client.js';

const MAX_LIMIT = 100;
const PAGE_CAP = 3; // 50 results/page → MAX_LIMIT in ≤2 pages; small buffer.

cli({
    site: 'nodeseek',
    name: 'search',
    access: 'read',
    description: 'Full-text search over NodeSeek posts (requires login)',
    domain: 'nodeseek.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 20, help: `Number of results, paging as needed (1-${MAX_LIMIT})` },
    ],
    columns: ['post_id', 'title', 'category', 'author', 'time', 'link'],
    func: async (page, kwargs) => {
        const q = requireNonEmptyQuery(kwargs.query, 'Search keyword');
        const limit = readLimit(kwargs.limit, { max: MAX_LIMIT });
        await ensureNsHome(page);
        if (!await hasNsSessionCookie(page))
            throw new AuthRequiredError('nodeseek.com', 'search requires login — run `opencli nodeseek login`');

        const searchUrl = (pageNo) => `${NS_HOME}/search?q=${encodeURIComponent(q)}&type=post` + (pageNo > 1 ? `&page=${pageNo}` : '');
        const collected = await collectPaged(page, {
            urlFor: searchUrl,
            scrape: scrapePostList,
            keyOf: (r) => (r.title && r.post_id) ? r.post_id : null,
            limit,
            pageCap: PAGE_CAP,
            label: `nodeseek search "${q}"`,
        });

        const rows = finalizeListRows(collected, limit);
        if (rows.length === 0)
            throw new EmptyResultError('nodeseek search', `No posts found for "${q}"`);
        return rows;
    },
});
