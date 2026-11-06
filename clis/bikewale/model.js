/**
 * bikewale model — every variant of one bike, with price and the specs that set
 * the variants apart.
 *
 * The model page `https://www.bikewale.com/<makeMask>-bikes/<modelMask>/`
 * SSR-embeds `modelPage.versions[]` inside `window.__INITIAL_STATE__`: each
 * trim's name, price (priceOverview) and `differentSpecs` (the items that
 * actually differ between variants — ABS, brakes, tyres, lights, ...). The make
 * + model args are resolved to the real slugs via the brand page, since slugs
 * are irregular ("royalenfield" stripped vs "hunter-350" hyphenated). PUBLIC
 * strategy: plain Node `fetch()`, no auth, no browser.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { BASE, fetchInitialState, resolveBrand, slugCore } from './utils.js';

const COLUMNS = ['variant', 'priceInr', 'formattedPrice', 'fuel', 'differences'];

/**
 * Petrol vs Electric. On the model page `isElectricVehicle` is unreliable (can
 * be false for an EV) but fuelTypeId is authoritative: 1 = Petrol, 5 = Electric.
 */
function fuelType(src) {
    if (src?.isElectricVehicle || src?.fuelTypeId === 5) return 'Electric';
    if (src?.fuelTypeId === 1) return 'Petrol';
    return null;
}

/** "Braking System: Single Channel ABS; Rear Brake Type: Drum; ..." */
function differencesText(version) {
    const list = Array.isArray(version?.differentSpecs) ? version.differentSpecs : [];
    return list
        .filter((s) => s?.itemName && s?.value != null && String(s.value).trim() !== '')
        .map((s) => `${String(s.itemName).trim()}: ${String(s.value).trim()}`)
        .join('; ');
}

/**
 * Resolve user make/model input to the model-page state via the brand page.
 *
 * The brand page lists every model with its authoritative makeMaskingName +
 * modelMaskingName, so we match the user's model against those (comparable core)
 * rather than guessing the slug shape. Returns the model-page state + names.
 */
async function resolveModel(makeInput, modelInput) {
    const modelCore = slugCore(modelInput);
    if (!modelCore) {
        throw new ArgumentError('model is required, e.g. "hunter 350", "classic 350".');
    }

    const { state: brandState, mask: makeMask } = await resolveBrand(makeInput);
    const models = Array.isArray(brandState?.makePage?.models) ? brandState.makePage.models : [];
    const hit = models.find(
        (m) => slugCore(m?.modelMaskingName) === modelCore || slugCore(m?.modelName) === modelCore,
    );
    if (!hit?.modelMaskingName) {
        const names = models.map((m) => m?.modelName).filter(Boolean).join(', ');
        throw new ArgumentError(
            `bikewale model "${modelInput}" not found for "${makeMask}".`,
            names ? `Available models: ${names}.` : 'Run `opencli bikewale brand <make>` to list models.',
        );
    }

    const modelMask = hit.modelMaskingName;
    const makeSlug = hit.makeMaskingName || makeMask;
    const state = await fetchInitialState(`${BASE}/${makeSlug}-bikes/${modelMask}/`, {
        context: `model "${makeSlug} ${modelMask}"`,
    });
    return { state, makeSlug, modelMask, modelName: hit.modelName };
}

/**
 * Pure parser: a model-page __INITIAL_STATE__ object → one row per variant.
 * Exported for unit tests / offline replay against fixtures.
 */
export function parseVariants(state, label) {
    const modelPage = state?.modelPage;
    if (!modelPage || typeof modelPage !== 'object') {
        throw new CommandExecutionError(
            `bikewale model ${label} returned no modelPage state.`,
            'BikeWale may have changed its model page structure.',
        );
    }
    // Fuel is a model-level fact (the per-version copy is left at 0), so derive
    // it once from modelDetails and apply to every variant row.
    const fuel = fuelType(modelPage.modelDetails);
    const versions = Array.isArray(modelPage.versions) ? modelPage.versions : [];
    return versions.map((v) => {
        const price = Number(v?.priceOverview?.price) || 0;
        return {
            variant: String(v?.versionName ?? '').trim(),
            priceInr: price > 0 ? price : null,
            formattedPrice: String(v?.priceOverview?.formattedPrice ?? '').trim(),
            fuel,
            differences: differencesText(v),
        };
    });
}

cli({
    site: 'bikewale',
    name: 'model',
    access: 'read',
    description:
        'List every variant of one bike: trim name, price, fuel and the specs that differ between variants (ABS, brakes, tyres, lights...).',
    example: 'opencli bikewale model royalenfield "hunter 350"',
    domain: 'bikewale',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'make',
            required: true,
            positional: true,
            help: 'Brand name / slug, e.g. "royalenfield", "honda".',
        },
        {
            name: 'model',
            required: true,
            positional: true,
            help: 'Model name / slug, e.g. "hunter 350", "classic-350".',
        },
    ],
    columns: COLUMNS,
    func: async (args) => {
        const { state, makeSlug, modelMask } = await resolveModel(args.make, args.model);
        const rows = parseVariants(state, `"${makeSlug} ${modelMask}"`);
        if (rows.length === 0) {
            throw new EmptyResultError(`bikewale model "${makeSlug} ${modelMask}"`);
        }
        return rows;
    },
});
