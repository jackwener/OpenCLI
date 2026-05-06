// Shared helpers for the PokeAPI (`pokeapi.co`) adapter.
//
// PokeAPI is a free, open Pokémon data RESTful API. No authentication;
// please cache aggressively per their docs. Endpoints we wrap:
//   GET /api/v2/pokemon/<name|id>     pokémon stats + moves + types
//   GET /api/v2/move/<name|id>        move metadata (power, accuracy, etc.)
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const POKEAPI_BASE = 'https://pokeapi.co/api/v2';
const UA = 'opencli-pokeapi-adapter (+https://github.com/jackwener/opencli)';

// PokeAPI accepts either a numeric national-dex id or a kebab-case name like
// "mr-mime", "mewtwo", "tapu-koko". We allow both.
const NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const ID_PATTERN = /^\d{1,6}$/;

export function requireRef(value, label = 'name') {
    const raw = String(value ?? '').trim();
    if (!raw) throw new ArgumentError(`pokeapi ${label} cannot be empty (e.g. "pikachu" or "25")`);
    if (ID_PATTERN.test(raw)) return raw;
    const lower = raw.toLowerCase();
    if (NAME_PATTERN.test(lower)) return lower;
    throw new ArgumentError(`pokeapi ${label} must be a national-dex id or a lowercase name (e.g. "tapu-koko")`);
}

export async function pokeapiFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that pokeapi.co is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `PokeAPI returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'PokeAPI throttles bursts; wait and retry.',
        );
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }
    let body;
    try {
        body = await resp.json();
    }
    catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
    return body;
}

/** PokeAPI surfaces stats as `[{base_stat, stat: {name}}, ...]`. Index by name. */
export function indexBaseStats(stats) {
    const map = {};
    if (!Array.isArray(stats)) return map;
    for (const s of stats) {
        const name = String(s?.stat?.name ?? '').trim();
        if (name) map[name] = Number(s.base_stat);
    }
    return map;
}

/** Pick the English-language name from a PokeAPI `names` array. */
export function pickEnglishName(names, fallback = '') {
    if (!Array.isArray(names)) return fallback;
    for (const n of names) {
        if (n?.language?.name === 'en') return String(n.name ?? '').trim();
    }
    return fallback;
}

/** Pick the latest English-language flavor text from a PokeAPI `flavor_text_entries` array. */
export function pickEnglishFlavorText(entries) {
    if (!Array.isArray(entries)) return '';
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e?.language?.name === 'en') {
            return String(e?.flavor_text ?? '').replace(/\s+/g, ' ').trim();
        }
    }
    return '';
}
