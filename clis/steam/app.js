// steam app — fetch a single Steam game / DLC / app's storefront detail.
//
// Hits the public appdetails API (`/api/appdetails?appids=<id>`). Surfaces
// the columns most useful for an agent: name, type, free flag, release
// date, developers / publishers, price, metacritic, recommendations,
// genres / categories joined.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { STEAM_STORE, decodeHtmlEntities, priceCents, requireAppId, requireCountryCode, steamFetch } from './utils.js';

function joinNames(list) {
    if (!Array.isArray(list)) return '';
    return list
        .map((entry) => (entry && typeof entry === 'object' ? entry.description ?? entry.name ?? '' : String(entry)))
        .filter(Boolean)
        .join(', ');
}

cli({
    site: 'steam',
    name: 'app',
    access: 'read',
    description: 'Steam storefront detail for a single app id',
    domain: 'store.steampowered.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Numeric Steam app id (e.g. "620" for Portal 2)' },
        { name: 'currency', default: 'us', help: 'Storefront country code (e.g. us / cn / jp / de)' },
    ],
    columns: [
        'id', 'name', 'type', 'isFree', 'releaseDate', 'developers', 'publishers',
        'price', 'currency', 'metacritic', 'recommendations', 'genres', 'categories',
        'shortDescription', 'website', 'url',
    ],
    func: async (args) => {
        const appId = requireAppId(args.id);
        const cc = requireCountryCode(args.currency);
        const url = `${STEAM_STORE}/api/appdetails?appids=${appId}&l=en&cc=${encodeURIComponent(cc)}`;
        const body = await steamFetch(url, `steam app ${appId}`);
        const wrapper = body?.[appId];
        if (!wrapper || wrapper.success !== true || !wrapper.data) {
            throw new EmptyResultError('steam app', `Steam app id ${appId} returned no data (may be region-locked or removed).`);
        }
        const data = wrapper.data;
        const isFree = data.is_free === true;
        const priceFinal = priceCents(data?.price_overview?.final ?? null);
        return [{
            id: String(data.steam_appid ?? appId),
            name: decodeHtmlEntities(data.name ?? ''),
            type: String(data.type ?? ''),
            isFree,
            releaseDate: String(data?.release_date?.date ?? ''),
            developers: Array.isArray(data.developers) ? data.developers.join(', ') : '',
            publishers: Array.isArray(data.publishers) ? data.publishers.join(', ') : '',
            price: isFree ? 0 : priceFinal,
            currency: String(data?.price_overview?.currency ?? '').toUpperCase(),
            metacritic: data?.metacritic?.score != null ? Number(data.metacritic.score) : null,
            recommendations: data?.recommendations?.total != null ? Number(data.recommendations.total) : null,
            genres: joinNames(data.genres),
            categories: joinNames(data.categories),
            shortDescription: decodeHtmlEntities(data.short_description ?? ''),
            website: String(data.website ?? ''),
            url: `${STEAM_STORE}/app/${data.steam_appid ?? appId}/`,
        }];
    },
});
