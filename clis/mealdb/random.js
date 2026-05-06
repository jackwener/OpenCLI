// mealdb random — N random recipes.
//
// Endpoint: GET /random.php  (returns 1 random recipe)
//
// To return N rows we hit the endpoint N times in parallel. TheMealDB has
// no batched random endpoint on the free tier, but their server caps each
// request at ~50ms so a small fan-out is fine.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { MEALDB_BASE, mealdbFetch, projectMeal } from './utils.js';

cli({
    site: 'mealdb',
    name: 'random',
    access: 'read',
    description: 'Random TheMealDB recipes',
    domain: 'themealdb.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'count', type: 'int', default: 1, help: 'Number of random recipes (1-10, default 1)' },
    ],
    columns: [
        'rank', 'id', 'name', 'category', 'area', 'tags',
        'ingredientCount', 'ingredients', 'instructions', 'thumb', 'youtube', 'source',
    ],
    func: async (args) => {
        const count = Number(args.count ?? 1);
        if (!Number.isInteger(count) || count < 1 || count > 10) {
            throw new ArgumentError('--count must be an integer between 1 and 10');
        }
        const url = `${MEALDB_BASE}/random.php`;
        // Fan out — TheMealDB de-duplicates internally per-call, but two calls
        // can land on the same recipe. We don't try to dedupe; users asking
        // for "5 random" implicitly accept that.
        const bodies = await Promise.all(Array.from({ length: count }, () => mealdbFetch(url, 'mealdb random')));
        const meals = [];
        for (const body of bodies) {
            const list = Array.isArray(body?.meals) ? body.meals : [];
            if (list.length) meals.push(list[0]);
        }
        if (!meals.length) {
            throw new EmptyResultError('mealdb random', 'TheMealDB returned no random recipes.');
        }
        return meals.map((m, i) => ({ rank: i + 1, ...projectMeal(m) }));
    },
});
