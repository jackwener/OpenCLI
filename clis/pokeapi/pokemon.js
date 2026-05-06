// pokeapi pokemon — fetch a single Pokémon's stats and metadata.
//
// Endpoint: GET /api/v2/pokemon/<name|id>
//
// Surfaces base stats (HP/Atk/Def/SpA/SpD/Spe), types as comma-string,
// abilities (with hidden marker), height/weight (already in PokeAPI's
// internal decimetre/hectogram units — we convert to metric), and the
// official artwork URL. Ref round-trips into `pokeapi pokemon <id>`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    POKEAPI_BASE,
    indexBaseStats,
    pokeapiFetch,
    requireRef,
} from './utils.js';

cli({
    site: 'pokeapi',
    name: 'pokemon',
    access: 'read',
    description: 'Look up a Pokémon by national-dex id or name',
    domain: 'pokeapi.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'ref', positional: true, required: true, help: 'National-dex id (e.g. 25) or kebab-case name (e.g. "pikachu", "tapu-koko")' },
    ],
    columns: [
        'id', 'name', 'types', 'abilities', 'heightM', 'weightKg',
        'baseExperience', 'hp', 'attack', 'defense',
        'specialAttack', 'specialDefense', 'speed',
        'totalStats', 'spriteUrl', 'artworkUrl', 'url',
    ],
    func: async (args) => {
        const ref = requireRef(args.ref, 'ref');
        const url = `${POKEAPI_BASE}/pokemon/${encodeURIComponent(ref)}`;
        const body = await pokeapiFetch(url, 'pokeapi pokemon');
        if (!body || !body.id) {
            throw new EmptyResultError('pokeapi pokemon', `PokeAPI returned no record for "${ref}".`);
        }
        const stats = indexBaseStats(body.stats);
        const total = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed']
            .reduce((acc, k) => acc + (stats[k] ?? 0), 0);
        const types = Array.isArray(body.types)
            ? body.types
                .slice()
                .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
                .map((t) => String(t?.type?.name ?? '').trim())
                .filter(Boolean)
                .join(', ')
            : '';
        const abilities = Array.isArray(body.abilities)
            ? body.abilities
                .slice()
                .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
                .map((a) => {
                    const name = String(a?.ability?.name ?? '').trim();
                    return a.is_hidden ? `${name} (hidden)` : name;
                })
                .filter(Boolean)
                .join(', ')
            : '';
        const sprite = body.sprites?.front_default ?? '';
        const artwork = body.sprites?.other?.['official-artwork']?.front_default ?? '';
        return [{
            id: Number(body.id),
            name: String(body.name ?? '').trim(),
            types,
            abilities,
            heightM: body.height != null ? Number(body.height) / 10 : null,
            weightKg: body.weight != null ? Number(body.weight) / 10 : null,
            baseExperience: body.base_experience != null ? Number(body.base_experience) : null,
            hp: stats.hp ?? null,
            attack: stats.attack ?? null,
            defense: stats.defense ?? null,
            specialAttack: stats['special-attack'] ?? null,
            specialDefense: stats['special-defense'] ?? null,
            speed: stats.speed ?? null,
            totalStats: total > 0 ? total : null,
            spriteUrl: String(sprite ?? ''),
            artworkUrl: String(artwork ?? ''),
            url: `https://pokeapi.co/api/v2/pokemon/${body.id}/`,
        }];
    },
});
