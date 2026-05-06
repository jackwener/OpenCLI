// mealdb shared helpers — TheMealDB recipe API (themealdb.com/api/json, no auth on test key "1").
//
// TheMealDB's free tier uses the literal string "1" as an API key, which is
// effectively no auth. Premium tier exists but we never need it for these
// commands.
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const MEALDB_BASE = 'https://www.themealdb.com/api/json/v1/1';
const UA = 'opencli-mealdb/1.0';

export function requireString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ArgumentError(`--${name} is required`);
    }
    return value.trim();
}

export function requireBoundedInt(value, fallback, max) {
    const v = value == null ? fallback : Number(value);
    if (!Number.isInteger(v) || v < 1 || v > max) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${max}`);
    }
    return v;
}

export async function mealdbFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `${label} returned 404.`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}.`);
    }
    try {
        return await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned non-JSON body: ${err.message}`);
    }
}

// Project a TheMealDB meal record into a stable shape. Their schema flattens
// 20 ingredient + 20 measure slots (`strIngredient1..20`, `strMeasure1..20`).
// We collapse non-empty pairs to "qty ingredient" tokens and join.
export function projectMeal(m) {
    const ingredients = [];
    for (let i = 1; i <= 20; i += 1) {
        const ing = String(m?.[`strIngredient${i}`] ?? '').trim();
        if (!ing) continue;
        const meas = String(m?.[`strMeasure${i}`] ?? '').trim();
        ingredients.push(meas ? `${meas} ${ing}` : ing);
    }
    return {
        id: String(m?.idMeal ?? '').trim(),
        name: String(m?.strMeal ?? '').trim(),
        category: String(m?.strCategory ?? '').trim(),
        area: String(m?.strArea ?? '').trim(),
        tags: String(m?.strTags ?? '').trim(),
        ingredientCount: ingredients.length,
        ingredients: ingredients.join(', '),
        instructions: String(m?.strInstructions ?? '').trim(),
        thumb: String(m?.strMealThumb ?? '').trim(),
        youtube: String(m?.strYoutube ?? '').trim(),
        source: String(m?.strSource ?? '').trim(),
    };
}
