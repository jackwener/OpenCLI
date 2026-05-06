// pokeapi move — fetch a single Pokémon move's metadata.
//
// Endpoint: GET /api/v2/move/<name|id>
//
// Surfaces power / accuracy / pp / priority + damage class + the latest
// English flavor text describing the move. `null` means PokeAPI has no
// value (not all moves have power, e.g. status moves).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    POKEAPI_BASE,
    pickEnglishFlavorText,
    pickEnglishName,
    pokeapiFetch,
    requireRef,
} from './utils.js';

cli({
    site: 'pokeapi',
    name: 'move',
    access: 'read',
    description: 'Look up a Pokémon move by id or kebab-case name',
    domain: 'pokeapi.co',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'ref', positional: true, required: true, help: 'Move id (e.g. 1) or kebab-case name (e.g. "thunderbolt", "u-turn")' },
    ],
    columns: [
        'id', 'name', 'displayName', 'type', 'damageClass',
        'power', 'accuracy', 'pp', 'priority', 'effectChance',
        'target', 'generation', 'flavorText', 'url',
    ],
    func: async (args) => {
        const ref = requireRef(args.ref, 'ref');
        const url = `${POKEAPI_BASE}/move/${encodeURIComponent(ref)}`;
        const body = await pokeapiFetch(url, 'pokeapi move');
        if (!body || !body.id) {
            throw new EmptyResultError('pokeapi move', `PokeAPI returned no record for "${ref}".`);
        }
        return [{
            id: Number(body.id),
            name: String(body.name ?? '').trim(),
            displayName: pickEnglishName(body.names, String(body.name ?? '').trim()),
            type: String(body.type?.name ?? '').trim(),
            damageClass: String(body.damage_class?.name ?? '').trim(),
            power: body.power != null ? Number(body.power) : null,
            accuracy: body.accuracy != null ? Number(body.accuracy) : null,
            pp: body.pp != null ? Number(body.pp) : null,
            priority: body.priority != null ? Number(body.priority) : null,
            effectChance: body.effect_chance != null ? Number(body.effect_chance) : null,
            target: String(body.target?.name ?? '').trim(),
            generation: String(body.generation?.name ?? '').trim(),
            flavorText: pickEnglishFlavorText(body.flavor_text_entries),
            url: `https://pokeapi.co/api/v2/move/${body.id}/`,
        }];
    },
});
