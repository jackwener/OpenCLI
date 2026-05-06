// ghibli people — Studio Ghibli film characters.
//
// Endpoint: GET /people
// `films` field comes back as an array of film URLs — surface as count for
// stable column shape (raw URL list would explode wide tables).
// `species` is a single URL — surface as id from trailing path segment.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { ghibliFetch, requireBoundedInt, GHIBLI_BASE } from './utils.js';

function urlToId(url) {
    if (typeof url !== 'string' || !url) return null;
    const m = url.match(/\/([^/]+)\/?$/);
    return m ? m[1] : null;
}

cli({
    site: 'ghibli',
    name: 'people',
    access: 'read',
    description: 'Studio Ghibli characters (across all films)',
    domain: 'ghibliapi.vercel.app',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 50, help: 'Max rows (1-100, default 50)' },
    ],
    columns: [
        'rank', 'id', 'name', 'gender', 'age', 'eyeColor', 'hairColor',
        'speciesId', 'filmsCount', 'url',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 50, 100);
        const url = `${GHIBLI_BASE}/people`;
        const body = await ghibliFetch(url, 'ghibli people');
        if (!Array.isArray(body) || body.length === 0) {
            throw new EmptyResultError('ghibli people', 'ghibliapi.vercel.app returned no characters.');
        }
        return body.slice(0, limit).map((p, i) => ({
            rank: i + 1,
            id: p?.id ?? null,
            name: p?.name ?? null,
            gender: p?.gender ? p.gender : null, // explicit null for empty string
            age: p?.age ? p.age : null,           // age can be 'NA' or '' — preserve null
            eyeColor: p?.eye_color ?? null,
            hairColor: p?.hair_color ?? null,
            speciesId: urlToId(p?.species),
            filmsCount: Array.isArray(p?.films) ? p.films.length : null,
            url: p?.url ?? null,
        }));
    },
});
