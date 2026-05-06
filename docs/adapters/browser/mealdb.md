# TheMealDB

**Mode**: 🌐 Public · **Domain**: `themealdb.com`

TheMealDB free recipe API. Free public test key (`1`) — no signup needed for `search` / `random`.

## Commands

| Command | Description |
|---------|-------------|
| `opencli mealdb search <query>` | Search recipes by name (free text) |
| `opencli mealdb random` | N random recipes (1–10) |

## Usage Examples

```bash
# Search by name
opencli mealdb search teriyaki
opencli mealdb search chicken --limit 10

# Random recipes
opencli mealdb random
opencli mealdb random --count 3
```

## Output Columns

Both commands share the same columns:

| Column | Meaning |
|--------|---------|
| `rank` | 1-based row index |
| `id` | TheMealDB meal id (stable join key) |
| `name` | Recipe name |
| `category` | e.g. `Seafood`, `Beef`, `Vegetarian` |
| `area` | Cuisine origin (e.g. `Italian`, `Japanese`) |
| `tags` | Comma-joined tags (may be empty) |
| `ingredientCount` | Number of non-empty ingredient slots |
| `ingredients` | `<measure> <ingredient>` joined with `, ` (max 20) |
| `instructions` | Full preparation text |
| `thumb` | Image URL |
| `youtube` | YouTube tutorial URL (often empty) |
| `source` | Original recipe source URL (often empty) |

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Recipe name fragment |
| `--limit` | Max rows (1–50, default 25) — applied client-side |

### `random`

| Option | Description |
|--------|-------------|
| `--count` | Number of random recipes (1–10, default 1) |

## Notes

- **Public test key `1`.** TheMealDB ships with a permanent free test key in the URL path (`/api/json/v1/1/...`). No signup required for `search` / `random`.
- **20-slot ingredient collapse.** TheMealDB stores ingredients as 20 paired fields `strIngredient1..20` + `strMeasure1..20`. The adapter walks the slots, drops empty pairs, and joins `<measure> <ingredient>` with `, ` so you get one readable column instead of 40.
- **`meals: null` for empty.** Search miss returns `{ meals: null }` (not `{ meals: [] }`) — the adapter normalizes both to `EmptyResultError`.
- **No batched random.** `random.php` returns exactly 1 recipe; for `--count N` the adapter fans out N parallel calls. TheMealDB does not deduplicate across calls, so two of N may collide on the same recipe; the adapter does not dedupe (users asking for "5 random" implicitly accept this).
- **`youtube` / `source` may be empty** — many community-submitted recipes have no upstream video or recipe page. Empty string, not `null`.
- **Errors.** Empty query / out-of-range limit / out-of-range count → `ArgumentError`; no matches → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
