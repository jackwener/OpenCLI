// steam search — search the Steam storefront catalog.
//
// Hits the public storesearch API (`/api/storesearch/?term=…`). Returns
// matched apps with id / name / price / metascore / platform support so
// the row's `id` round-trips into `steam app`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    STEAM_STORE,
    decodeHtmlEntities,
    priceCents,
    requireBoundedInt,
    requireCountryCode,
    requireString,
    steamFetch,
} from './utils.js';

function platformList(platforms) {
    if (!platforms || typeof platforms !== 'object') return '';
    return ['windows', 'mac', 'linux'].filter((p) => platforms[p]).join(',');
}

cli({
    site: 'steam',
    name: 'search',
    access: 'read',
    description: 'Search the Steam storefront by name keyword',
    domain: 'store.steampowered.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "portal", "stardew")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-50)' },
        { name: 'currency', default: 'us', help: 'Storefront country code (e.g. us / cn / jp / de)' },
    ],
    columns: ['rank', 'id', 'name', 'price', 'currency', 'metascore', 'platforms', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 50);
        const cc = requireCountryCode(args.currency);
        const url = `${STEAM_STORE}/api/storesearch/?term=${encodeURIComponent(query)}&l=en&cc=${encodeURIComponent(cc)}`;
        const body = await steamFetch(url, 'steam search');
        const items = Array.isArray(body?.items) ? body.items : [];
        if (!items.length) {
            throw new EmptyResultError('steam search', `No Steam results matched "${query}".`);
        }
        return items.slice(0, limit).map((item, i) => ({
            rank: i + 1,
            id: String(item.id ?? ''),
            name: decodeHtmlEntities(item.name ?? ''),
            price: priceCents(item?.price?.final ?? null),
            currency: String(item?.price?.currency ?? '').toUpperCase(),
            metascore: item.metascore != null && item.metascore !== '' ? Number(item.metascore) : null,
            platforms: platformList(item.platforms),
            url: item.id ? `${STEAM_STORE}/app/${item.id}/` : '',
        }));
    },
});
