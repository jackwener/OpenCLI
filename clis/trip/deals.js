/**
 * Trip.com (international) running-promotions listing.
 *
 * Trip.com curates its live campaigns on a "Today's Top Deals" hub
 * (`/sale/deals/`), each a promo tile linking to a dedicated campaign page. The
 * hub renders client-side, so this reads the rendered `.top-deals_link-item`
 * tiles (title, offer line, parsed discount, campaign URL) the same way the other
 * browser-mode trip commands read their result cards. The per-campaign terms and
 * bookable inventory live on the linked page and are out of scope here.
 */
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { WAIT_FOR_DEALS_JS, buildDealsExtractJs, buildDealsUrl, parseListLimit } from './utils.js';

cli({
    site: 'trip',
    name: 'deals',
    access: 'read',
    description: 'List Trip.com live promotions from the Top Deals hub: campaign title, offer, discount, and link',
    domain: 'trip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of deals (1-50)' },
    ],
    columns: [
        'rank',
        'title', 'offer',
        'discount',
        'url',
    ],
    func: async (page, kwargs) => {
        const limit = parseListLimit(kwargs.limit);

        await page.goto(buildDealsUrl());
        const waitResult = await page.evaluate(WAIT_FOR_DEALS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('trip.com', 'Trip.com is asking for a verification; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Trip.com deals page did not render deal tiles (state=${String(waitResult)})`);
        }
        const raw = await page.evaluate(buildDealsExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Trip.com deals DOM extraction returned malformed rows');
        }
        // The Top Deals hub is a permanent curated page, so once the wait confirms it
        // rendered, zero parsed tiles means the tile markup drifted, not an empty hub.
        if (raw.length === 0) {
            throw new CommandExecutionError('Trip.com deals hub rendered but no promotion tiles parsed (the tile markup may have changed)');
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            title: r.title,
            offer: r.offer,
            discount: r.discount,
            url: r.url,
        }));
    },
});
