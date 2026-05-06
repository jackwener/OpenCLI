// mealdb search — search recipes by name (free text).
//
// Endpoint: GET /search.php?s=<query>
//
// Returns one row per matched recipe with full instructions + ingredient list.
// TheMealDB's search endpoint returns at most ~25 hits with no pagination, so
// we just slice client-side.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    MEALDB_BASE,
    mealdbFetch,
    projectMeal,
    requireBoundedInt,
    requireString,
} from './utils.js';

cli({
    site: 'mealdb',
    name: 'search',
    access: 'read',
    description: 'Search TheMealDB recipes by name',
    domain: 'themealdb.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Recipe name fragment (e.g. "chicken")' },
        { name: 'limit', type: 'int', default: 25, help: 'Max rows (1-50, default 25)' },
    ],
    columns: [
        'rank', 'id', 'name', 'category', 'area', 'tags',
        'ingredientCount', 'ingredients', 'instructions', 'thumb', 'youtube', 'source',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 25, 50);
        const url = `${MEALDB_BASE}/search.php?s=${encodeURIComponent(query)}`;
        const body = await mealdbFetch(url, 'mealdb search');
        // TheMealDB returns `{ meals: null }` for no matches, not `{ meals: [] }`.
        const list = Array.isArray(body?.meals) ? body.meals : [];
        if (!list.length) {
            throw new EmptyResultError('mealdb search', `TheMealDB returned no recipes matching "${query}".`);
        }
        return list.slice(0, limit).map((m, i) => ({ rank: i + 1, ...projectMeal(m) }));
    },
});
