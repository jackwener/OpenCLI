# PokéAPI

**Mode**: 🌐 Public · **Domain**: `pokeapi.co`

Pokémon and move data from the open PokéAPI. No auth, no rate-limit signup.

## Commands

| Command | Description |
|---------|-------------|
| `opencli pokeapi pokemon <ref>` | Pokémon detail by name or pokédex id (stats, types, abilities, sprite) |
| `opencli pokeapi move <ref>` | Move detail by name or id (type, damage class, power, accuracy, flavor text) |

## Usage Examples

```bash
# By name
opencli pokeapi pokemon pikachu
opencli pokeapi pokemon charizard

# By pokédex id
opencli pokeapi pokemon 25

# Move
opencli pokeapi move thunderbolt
opencli pokeapi move 85
```

## Output Columns

| Command | Columns |
|---------|---------|
| `pokemon` | `id, name, heightM, weightKg, baseExperience, types, hp, attack, defense, specialAttack, specialDefense, speed, totalStats, abilities, sprite, artwork` |
| `move` | `id, name, displayName, type, damageClass, power, accuracy, pp, priority, effectChance, target, generation, flavorText` |

## Options

### `pokemon`

| Option | Description |
|--------|-------------|
| `ref` (positional) | Pokémon name (kebab-case, e.g. `pikachu`, `mr-mime`) or pokédex id |

### `move`

| Option | Description |
|--------|-------------|
| `ref` (positional) | Move name (kebab-case, e.g. `thunderbolt`) or id |

## Notes

- **Units converted.** PokéAPI ships `height` in decimetres and `weight` in hectograms — the adapter exposes `heightM` / `weightKg` so columns read like the Pokédex.
- **`totalStats`** is the sum of all six base stats (HP/Atk/Def/SpA/SpD/Spe), the standard "BST" trainers compare.
- **Abilities** are sorted by `slot` and tag hidden ones explicitly: `"static, lightning-rod (hidden)"` — never silently omitted.
- **`flavorText`** picks the *latest* English-language entry from `flavor_text_entries`, so newer-game wording wins over older Gen-I copy when both are present.
- **`displayName`** comes from the localized `names[]` array (English) — the human-readable form (e.g. `Thunderbolt`) — while `name` keeps the API slug (`thunderbolt`).
- **Errors.** Empty / structurally bad ref → `ArgumentError`; 404 from PokéAPI → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
