/**
 * bikewale news — latest bike news & road tests from BikeWale's editorial desk.
 *
 * The news listing `https://www.bikewale.com/news/` (and `/news/page/N/`)
 * SSR-embeds its articles at `editorialListing.contentData[]` inside
 * `window.__INITIAL_STATE__` — title, author, category, relative date, view
 * count and article URL. ~18 articles per page. PUBLIC strategy: plain Node
 * `fetch()`, no auth, no browser.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { BASE, fetchInitialState } from './utils.js';

const COLUMNS = ['title', 'author', 'category', 'date', 'views', 'url'];

/** Validate the optional page arg → positive integer (no silent clamp). */
function parsePage(input) {
    if (input === undefined || input === null || input === '') return 1;
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1) {
        throw new ArgumentError(`page must be a positive integer, got "${input}".`);
    }
    return n;
}

/**
 * Pure parser: an __INITIAL_STATE__ object → one row per article. Exported for
 * unit tests / offline replay against fixtures.
 */
export function parseNews(state) {
    const listing = state?.editorialListing;
    if (!listing || typeof listing !== 'object') {
        throw new CommandExecutionError(
            'bikewale news returned no editorialListing state.',
            'BikeWale may have changed its news page structure.',
        );
    }
    const items = Array.isArray(listing.contentData) ? listing.contentData : [];
    return items.map((a) => ({
        title: String(a?.title ?? '').trim(),
        author: String(a?.authorName ?? '').trim(),
        category: String(a?.categoryMaskingName ?? '').trim(),
        date: String(a?.displayDate ?? '').trim(),
        views: Number(a?.views) || 0,
        url: a?.url ? `${BASE}${a.url}` : '',
    }));
}

cli({
    site: 'bikewale',
    name: 'news',
    access: 'read',
    description:
        'Latest BikeWale bike news & road tests: headline, author, category, relative date and view count (~18 per page).',
    example: 'opencli bikewale news',
    domain: 'bikewale',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'page',
            required: false,
            positional: true,
            help: 'Page number (default 1); each page is ~18 articles.',
        },
    ],
    columns: COLUMNS,
    func: async (args) => {
        const page = parsePage(args.page);
        const path = page === 1 ? '/news/' : `/news/page/${page}/`;
        const state = await fetchInitialState(`${BASE}${path}`, { context: `news page ${page}` });

        const rows = parseNews(state);
        if (rows.length === 0) {
            throw new EmptyResultError(`bikewale news page ${page}`);
        }
        return rows;
    },
});
