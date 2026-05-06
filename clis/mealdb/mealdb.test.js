import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './random.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

const sampleMeal = {
    idMeal: '52772', strMeal: 'Teriyaki Chicken Casserole',
    strCategory: 'Chicken', strArea: 'Japanese', strTags: 'Meat,Casserole',
    strInstructions: 'Preheat oven. Cook chicken. ...',
    strMealThumb: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
    strYoutube: 'https://www.youtube.com/watch?v=4aZr5hZXP_s',
    strSource: '', strIngredient1: 'soy sauce', strMeasure1: '3/4 cup',
    strIngredient2: 'water', strMeasure2: '1/2 cup',
    strIngredient3: 'brown sugar', strMeasure3: '1/4 cup',
};

describe('mealdb search', () => {
    const cmd = getRegistry().get('mealdb/search');

    it('rejects empty query', async () => {
        await expect(cmd.func({ query: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes meals=null to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ meals: null }), { status: 200 })));
        await expect(cmd.func({ query: 'zzzznoteaten' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes a search row + collapses ingredient slots', async () => {
        const sample = { meals: [sampleMeal] };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ query: 'teriyaki' });
        expect(rows[0].id).toBe('52772');
        expect(rows[0].name).toBe('Teriyaki Chicken Casserole');
        expect(rows[0].ingredientCount).toBe(3);
        expect(rows[0].ingredients).toBe('3/4 cup soy sauce, 1/2 cup water, 1/4 cup brown sugar');
        expect(rows[0].area).toBe('Japanese');
    });
});

describe('mealdb random', () => {
    const cmd = getRegistry().get('mealdb/random');

    it('rejects --count > 10', async () => {
        await expect(cmd.func({ count: 50 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('returns N rows after N parallel fetches', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ meals: [sampleMeal] }), { status: 200 })));
        const rows = await cmd.func({ count: 3 });
        expect(rows).toHaveLength(3);
        expect(rows[0].rank).toBe(1);
        expect(rows[2].rank).toBe(3);
        expect(global.fetch).toHaveBeenCalledTimes(3);
    });
});
