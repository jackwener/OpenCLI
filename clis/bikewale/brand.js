/**
 * bikewale brand — every model a brand sells, at a glance.
 *
 * BikeWale renders each brand page `https://www.bikewale.com/<mask>-bikes/`
 * server-side and embeds the hydration state inline as
 * `window.__INITIAL_STATE__ = {...}`. A plain Node `fetch()` (no auth, no
 * browser) returns that blob; `.makePage.models[]` is the per-model list with
 * price, rating, key specs and launch status. PUBLIC strategy: stable SSR
 * contract, same shape the page itself renders.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { BASE, resolveBrand } from './utils.js';

const COLUMNS = [
    'model',
    'brand',
    'status',
    'priceInr',
    'formattedPrice',
    'rating',
    'reviews',
    'displacementCc',
    'mileageKmpl',
    'maxPowerBhp',
    'fuel',
    'url',
];

/** Read a numeric specsSummary entry by itemName prefix; null when absent. */
function specValue(model, namePrefix) {
    const list = Array.isArray(model.specsSummary) ? model.specsSummary : [];
    const hit = list.find(
        (s) => typeof s.itemName === 'string' && s.itemName.toLowerCase().startsWith(namePrefix),
    );
    if (!hit) return null;
    const n = Number(hit.value);
    return Number.isFinite(n) ? n : null;
}

/** status 2 = on sale, 1 = upcoming; anything else falls back to the code. */
function modelStatus(model) {
    if (model.status === 2) return 'on-sale';
    if (model.status === 1) return 'upcoming';
    return `status-${model.status}`;
}

/** Petrol vs Electric from the EV flag / fuelTypeId; null for unpriced upcoming. */
function fuelType(model) {
    if (model.isElectricVehicle) return 'Electric';
    if (model.fuelTypeId === 1) return 'Petrol';
    return null;
}

/**
 * Pure parser: an __INITIAL_STATE__ object → one row per model. Exported for
 * unit tests / offline replay against fixtures.
 */
export function parseBrandModels(state, mask) {
    const makePage = state && state.makePage;
    if (!makePage || typeof makePage !== 'object') {
        throw new CommandExecutionError(
            `bikewale brand "${mask}" returned no makePage state.`,
            'BikeWale may have changed its page structure, or the brand slug is wrong.',
        );
    }
    const models = Array.isArray(makePage.models) ? makePage.models : [];
    return models.map((m) => {
        const price = Number(m?.priceOverview?.price) || 0;
        const reviews = Number(m?.modelReviewCount) || 0;
        const ratingRaw = Number(m?.modelAggregateRating);
        return {
            model: String(m?.modelName ?? '').trim(),
            brand: String(m?.makeName ?? '').trim(),
            status: modelStatus(m),
            priceInr: price > 0 ? price : null,
            formattedPrice: String(m?.priceOverview?.formattedPrice ?? '').trim(),
            rating: reviews > 0 && ratingRaw > 0 ? ratingRaw : null,
            reviews,
            displacementCc: specValue(m, 'displacement'),
            mileageKmpl: specValue(m, 'mileage'),
            maxPowerBhp: specValue(m, 'max power'),
            fuel: fuelType(m),
            url: m?.modelMaskingName
                ? `${BASE}/${m.makeMaskingName ?? mask}-bikes/${m.modelMaskingName}/`
                : '',
        };
    });
}

cli({
    site: 'bikewale',
    name: 'brand',
    access: 'read',
    description:
        'List every model a BikeWale brand sells: price, rating, key specs (displacement / mileage / power) and on-sale vs upcoming status.',
    example: 'opencli bikewale brand royalenfield',
    domain: 'bikewale',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'brand',
            required: true,
            positional: true,
            help: 'Brand name / slug, e.g. "royalenfield", "honda", "bajaj", "tvs".',
        },
    ],
    columns: COLUMNS,
    func: async (args) => {
        const { state, mask } = await resolveBrand(args.brand);

        const rows = parseBrandModels(state, mask);
        if (rows.length === 0) {
            throw new EmptyResultError(`bikewale brand "${mask}"`);
        }
        return rows;
    },
});
