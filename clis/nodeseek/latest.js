// nodeseek latest — newest posts from NodeSeek's home or a category board.
//
// NodeSeek is behind Cloudflare, so we read the server-rendered post list off
// the home page (`/`, `/page-N`) or a board (`/categories/<slug>?page=N`) via
// the browser — no login required. `--category` browses that board directly
// (server-side), and `--limit` walks pages (50 posts each) as needed.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { collectPaged, ensureNsHome, readLimit as readLimitShared, NS_HOME, scrapePostList, finalizeListRows } from './client.js';
import { CATEGORIES as BOARDS } from './categories.js';

// Known NodeSeek category slugs, derived from the canonical board table in
// categories.js so `nodeseek categories` and `--category` validation can't drift.
export const CATEGORIES = BOARDS.map((c) => c.slug);
const CATEGORY_SET = new Set(CATEGORIES);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PAGE_CAP = 5; // 50 posts/page → MAX_LIMIT in ≤2 pages; small buffer.

const readLimit = (value) => readLimitShared(value, { max: MAX_LIMIT, def: DEFAULT_LIMIT });

/** Resolve the board to browse from the --category argument. */
function resolveBoard(category) {
    const c = (category || '').trim().toLowerCase();
    if (!c)
        return { isCategory: false };
    if (!CATEGORY_SET.has(c))
        throw new ArgumentError(`Unknown board "${c}"`, `Options: ${CATEGORIES.join(', ')}`);
    return { isCategory: true, slug: c };
}

/** Build the URL for a given page of the home feed or a category board. */
function pageUrl(board, pageNo) {
    if (board.isCategory)
        return `${NS_HOME}/categories/${board.slug}` + (pageNo > 1 ? `?page=${pageNo}` : '');
    return pageNo > 1 ? `${NS_HOME}/page-${pageNo}` : `${NS_HOME}/`;
}

cli({
    site: 'nodeseek',
    name: 'latest',
    access: 'read',
    description: 'NodeSeek newest posts (home or --category board; no login)',
    domain: 'nodeseek.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'category', type: 'string', default: '', help: `Browse a board: ${CATEGORIES.join(', ')}` },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of posts, paging as needed (1-${MAX_LIMIT})` },
    ],
    columns: ['post_id', 'title', 'category', 'author', 'time', 'link'],
    func: async (page, kwargs) => {
        const limit = readLimit(kwargs.limit);
        const board = resolveBoard(kwargs.category);
        await ensureNsHome(page); // pass Cloudflare on home first

        const collected = await collectPaged(page, {
            urlFor: (pageNo) => pageUrl(board, pageNo),
            scrape: scrapePostList,
            keyOf: (r) => (r.title && r.post_id) ? r.post_id : null,
            limit,
            pageCap: PAGE_CAP,
            label: 'nodeseek latest',
            skipFirstNav: !board.isCategory, // ensureNsHome already landed on home = page 1
        });

        const out = finalizeListRows(collected, limit);
        if (out.length === 0)
            throw new EmptyResultError('nodeseek latest', 'No posts found');
        return out;
    },
});

export const __test__ = { CATEGORIES, readLimit, resolveBoard, pageUrl };
