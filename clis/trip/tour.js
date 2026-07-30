/**
 * Trip.com (international) tour-package search by destination keyword.
 *
 * Trip.com's tour results (`package-tours/list?kwd=<keyword>`) load through a
 * signed POST that only fires on a search submit, so this navigates the results
 * page and lets the page issue its own signed request while a fetch hook captures
 * the `products` response, rather than replaying the signature (see
 * `buildTourSearchJs` in utils). Per-departure pricing and availability sit behind
 * the booking step; the row `price` is the starting per-person estimate shown.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildTourSearchJs, buildTourSearchUrl, parseKeyword, parseListLimit } from './utils.js';

const TOUR_TABS = { private: 'privateTours', group: 'groupTours' };

function parseTourType(raw) {
    if (raw === undefined || raw === null || raw === '') return TOUR_TABS.private;
    const value = String(raw).trim().toLowerCase();
    if (!TOUR_TABS[value]) {
        throw new ArgumentError(`--type must be private or group, got ${JSON.stringify(raw)}`);
    }
    return TOUR_TABS[value];
}

cli({
    site: 'trip',
    name: 'tour',
    access: 'read',
    description: 'Search Trip.com tour packages by destination keyword (private or group tours)',
    domain: 'trip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Destination or tour keyword (e.g. Tokyo / Kyoto / Bali)' },
        { name: 'type', default: 'private', help: 'Tour line: private or group (default private)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of tours (1-50)' },
    ],
    columns: [
        'rank',
        'name', 'type',
        'rating', 'reviews',
        'price', 'currency',
        'url',
    ],
    func: async (page, kwargs) => {
        const query = parseKeyword('query', kwargs.query);
        const tourType = parseTourType(kwargs.type);
        const limit = parseListLimit(kwargs.limit);

        const searchUrl = buildTourSearchUrl(query, tourType);
        await page.goto(searchUrl);
        const result = await page.evaluate(buildTourSearchJs(query));
        if (!result || typeof result !== 'object') {
            throw new CommandExecutionError('Trip.com tour search returned malformed data');
        }
        if (result.status === 'captcha') {
            throw new AuthRequiredError('trip.com', 'Trip.com is asking for a verification; complete it in your browser session and retry');
        }
        if (result.status === 'empty') {
            throw new EmptyResultError('trip tour', `No ${kwargs.type || 'private'} tours for "${query}"`);
        }
        if (result.status !== 'content') {
            throw new CommandExecutionError(`Trip.com tour search did not return results (state=${String(result.status)})`);
        }
        // Products captured but none carry a name is drift (schema moved), not an empty search;
        // a genuine no-match resolves as status 'empty' above off the page's "0 routes found".
        const rows = Array.isArray(result.rows) ? result.rows.filter((r) => r.name) : [];
        if (rows.length === 0) {
            throw new CommandExecutionError('Trip.com tour search captured products but none carried a name (the product markup may have changed)');
        }
        return rows.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            name: r.name,
            type: r.type,
            rating: r.rating,
            reviews: r.reviews,
            price: r.price,
            currency: 'USD',
            url: r.url,
        }));
    },
});
