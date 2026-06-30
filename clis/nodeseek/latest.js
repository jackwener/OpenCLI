// nodeseek latest — newest posts from NodeSeek's home or a category board.
//
// NodeSeek is behind Cloudflare, so we read the server-rendered post list off
// the home page (`/`, `/page-N`) or a board (`/categories/<slug>?page=N`) via
// the browser — no login required. `--category` browses that board directly
// (server-side), and `--limit` walks pages (50 posts each) as needed.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import { ensureNsHome, readLimit as readLimitShared, NS_HOME, scrapePostList, finalizeListRows } from './client.js';

// Known NodeSeek category slugs (from the site's category bar).
export const CATEGORIES = [
    'daily', 'tech', 'info', 'review', 'trade', 'carpool',
    'promotion', 'life', 'dev', 'photo-share', 'expose', 'inside', 'sandbox',
];
const CATEGORY_SET = new Set(CATEGORIES);

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PAGE_CAP = 5; // 50 posts/page → MAX_LIMIT in ≤2 pages; small buffer.

const readLimit = (value) => readLimitShared(value, { max: MAX_LIMIT, def: DEFAULT_LIMIT, command: 'nodeseek latest' });

/** Resolve the board to browse from the --category argument. */
function resolveBoard(category) {
    const c = (category || '').trim().toLowerCase();
    if (!c)
        return { isCategory: false };
    if (!CATEGORY_SET.has(c))
        throw new ArgumentError('nodeseek latest', `Unknown board "${c}". Options: ${CATEGORIES.join(', ')}`);
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

        const collected = [];
        const seen = new Set();
        for (let pageNo = 1; pageNo <= PAGE_CAP && collected.length < limit; pageNo++) {
            await page.goto(pageUrl(board, pageNo));
            await page.wait(2);
            const rows = await scrapePostList(page);
            let fresh = 0;
            for (const r of rows) {
                if (!r.title || !r.post_id || seen.has(r.post_id))
                    continue;
                seen.add(r.post_id);
                collected.push(r);
                fresh++;
            }
            if (fresh === 0)
                break; // reached the end (empty page or all duplicates)
            if (collected.length < limit)
                log.status(`nodeseek latest: fetched page ${pageNo} (${collected.length} posts)`);
        }

        const out = finalizeListRows(collected, limit);
        if (out.length === 0)
            throw new EmptyResultError('nodeseek latest', 'No posts found');
        return out;
    },
});

export const __test__ = { CATEGORIES, readLimit, resolveBoard, pageUrl };
