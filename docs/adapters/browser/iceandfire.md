# An API of Ice and Fire

**Mode**: 🌐 Public · **Domain**: `anapioficeandfire.com`

A Song of Ice and Fire (Game of Thrones) book + character data from the public REST API at `anapioficeandfire.com/api`. No auth, no API key. Server pages at 50/req max — adapter walks pages until `--limit` is hit.

## Commands

| Command | Description |
|---------|-------------|
| `opencli iceandfire books` | ASOIAF books (filter by name + release date) |
| `opencli iceandfire characters` | ASOIAF character listing (filter by name / culture / gender) |

## Usage Examples

```bash
# Books
opencli iceandfire books --limit 20
opencli iceandfire books --name "Game of Thrones"
opencli iceandfire books --from-release-date 1996-01-01 --to-release-date 2000-12-31

# Characters
opencli iceandfire characters --limit 50
opencli iceandfire characters --culture Northmen --limit 100
opencli iceandfire characters --gender Female --culture Dornish
opencli iceandfire characters --name Stark
```

## Output Columns

| Command | Columns |
|---------|---------|
| `books` | `rank, id, name, isbn, authors, numberOfPages, publisher, country, mediaType, released, charactersCount, povCharactersCount, url` |
| `characters` | `rank, id, name, gender, culture, born, died, aliases, titles, allegiances, books, tvSeries, url` |

`charactersCount` / `povCharactersCount` (on `books`) and `allegiances` / `books` (on `characters`) are array lengths — raw URL arrays would explode column shape. Use the canonical book / character URL fields to drill down.

## Options

### `books`

| Option | Description |
|--------|-------------|
| `--limit` | Max rows (1–200, default 20). Pages walked at 50/page until limit hit. |
| `--name` | Filter by book name substring |
| `--from-release-date` | ISO 8601 lower bound (e.g. `1996-01-01`) |
| `--to-release-date` | ISO 8601 upper bound (e.g. `2025-12-31`) |

### `characters`

| Option | Description |
|--------|-------------|
| `--limit` | Max rows (1–500, default 20). Pages walked at 50/page until limit hit. |
| `--name` | Filter by name substring |
| `--culture` | Filter by culture (e.g. `Northmen`, `Dornish`, `Ironborn`) |
| `--gender` | Filter by gender (`Male` \| `Female`) |

## Notes

- **Server-fixed page size of 50.** Upstream uses `?page=N&pageSize=50`; adapter walks pages until `--limit` is reached or the last page returns < 50 rows.
- **`id` extracted from `url`.** Upstream returns no integer id field — only URLs like `https://anapioficeandfire.com/api/characters/823`. Adapter pulls the trailing digits via regex for a stable round-trip key.
- **Empty strings preserved as `null`.** `gender: ''` / `born: ''` / `died: ''` / `culture: ''` are common (especially for minor characters) — coerced to `null` so the column doesn't silently render as `''`.
- **`aliases` / `titles` joined with comma; empty → `null`.** Upstream returns `[]` or `['']` for missing fields; adapter filters falsy entries before joining and surfaces `null` when nothing is left.
- **`allegiances` / `books` are counts.** Raw URL arrays would explode wide tables — counts let you see at a glance which characters have rich relationships.
- **`tvSeries` joined as comma list.** Small array (~8 entries max for season names) — surfaced as a string for readability.
- **Errors.** `--limit` out of range → `ArgumentError`; empty result for filters → `EmptyResultError`; 429 → `CommandExecutionError`; other non-200 → `CommandExecutionError`.
