/**
 * bikewale brands — the full list of bike/scooter makers on BikeWale.
 *
 * The homepage SSR state carries `homePage.makeList` (61 brands, popularity
 * sorted) with each maker's display name, masking slug and popularity score.
 * The slug feeds straight into `bikewale brand <slug>`. PUBLIC strategy:
 * plain Node `fetch()` of the homepage, no auth, no browser.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { BASE, fetchInitialState } from './utils.js';

const COLUMNS = ['brand', 'slug', 'makeId', 'popularity', 'url'];

/**
 * Pure parser: an __INITIAL_STATE__ object → one row per brand. Exported for
 * unit tests / offline replay against fixtures.
 */
export function parseBrands(state) {
    const list = state?.homePage?.makeList;
    const makes = Array.isArray(list) ? list : [];
    return makes.map((m) => ({
        brand: String(m?.makeName ?? '').trim(),
        slug: String(m?.maskingName ?? '').trim(),
        makeId: Number(m?.makeId) || null,
        popularity: Number(m?.popularity) || 0,
        url: m?.maskingName ? `${BASE}/${m.maskingName}-bikes/` : '',
    }));
}

cli({
    site: 'bikewale',
    name: 'brands',
    access: 'read',
    description:
        'List every bike/scooter brand on BikeWale (name, slug for `bikewale brand`, popularity), sorted by popularity.',
    example: 'opencli bikewale brands',
    domain: 'bikewale',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: COLUMNS,
    func: async () => {
        const state = await fetchInitialState(`${BASE}/`, { context: 'brands' });
        const rows = parseBrands(state);
        if (rows.length === 0) {
            throw new EmptyResultError('bikewale brands');
        }
        return rows;
    },
});
