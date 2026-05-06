# Rick and Morty

**Mode**: 🌐 Public · **Domain**: `rickandmortyapi.com`

Rick and Morty character / episode / location data from the public REST API at `rickandmortyapi.com/api`. No auth, no API key. Stable schema with documented filter params.

## Commands

| Command | Description |
|---------|-------------|
| `opencli rickandmorty character` | Search characters by name / status / species |
| `opencli rickandmorty episode` | List episodes (filter by name or production code) |

## Usage Examples

```bash
# Search characters
opencli rickandmorty character --name Rick --limit 5
opencli rickandmorty character --status alive --species Human --limit 10
opencli rickandmorty character --limit 50

# Episode listing
opencli rickandmorty episode --limit 5
opencli rickandmorty episode --episode S01
opencli rickandmorty episode --name Pilot
```

## Output Columns

| Command | Columns |
|---------|---------|
| `character` | `rank, id, name, status, species, type, gender, origin, location, episodes, image, created, url` |
| `episode` | `rank, id, name, airDate, episodeCode, characters, created, url` |

`episodes` (count) and `characters` (count) summarize array lengths — raw URL arrays would explode column shape.

## Options

### `character`

| Option | Description |
|--------|-------------|
| `--limit` | Max rows (1–100, default 20). Pages walked client-side at 20/page. |
| `--name` | Substring filter on character name (case-insensitive on the server) |
| `--status` | `alive` \| `dead` \| `unknown` |
| `--species` | Species filter (e.g. `Human`, `Alien`, `Robot`) |

### `episode`

| Option | Description |
|--------|-------------|
| `--limit` | Max rows (1–100, default 20) |
| `--name` | Substring filter on episode title |
| `--episode` | Production code filter (e.g. `S01` to match all of season 1, `S01E01` for a specific episode) |

## Notes

- **Server-fixed page size of 20.** No `?limit=N` param exists; the adapter walks pages until `--limit` is hit or `info.next` is null. Pages are 50 ms apart on average so `--limit 100` is ~5 round-trips.
- **`type: ''` preserved as `null`.** Most characters have an empty `type` field on the upstream — adapter coerces empty string → `null` so the column doesn't silently fall back to `''`.
- **404 = no matches, not error.** When a filter combination matches zero characters/episodes, the API returns HTTP 404 with `{error: "There is nothing here"}`. Adapter promotes this to `EmptyResultError`.
- **`origin` / `location` flattened to `name`.** Upstream returns `{name, url}` objects — adapter surfaces just `name` since the URL adds no value over the `id` column.
- **`episodes` / `characters` as counts, not URL arrays.** Stable column shape for tabular display. Use detail commands or follow the upstream URL for individual episode/character lookups.
- **Errors.** `--limit` out of range → `ArgumentError`; 404 / empty results → `EmptyResultError`; 429 → `CommandExecutionError` with rate-limit hint; transport / non-200 → `CommandExecutionError`.
