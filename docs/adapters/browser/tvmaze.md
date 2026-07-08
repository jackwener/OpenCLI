# TVmaze

**Mode**: 🌐 Public · **Domain**: `tvmaze.com`

Search TVmaze for TV shows by title, or fetch full show details by id. Hits the unauthenticated `api.tvmaze.com` directly.

## Commands

| Command | Description |
|---------|-------------|
| `opencli tvmaze search <query>` | TVmaze TV show search by title (returns id, name, network, premiered/ended, rating) |
| `opencli tvmaze show <id>` | Single TV show detail (network, schedule, rating, IMDB/TheTVDB cross-refs) |

## Usage Examples

```bash
# Title search
opencli tvmaze search "breaking bad"
opencli tvmaze search succession --limit 5

# Show detail (id from search)
opencli tvmaze show 169
opencli tvmaze show 169 -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, id, name, type, language, genres, status, premiered, ended, network, rating, matchScore, summary, url` |
| `show` | `id, name, type, language, genres, status, premiered, ended, runtime, averageRuntime, network, country, schedule, rating, imdb, thetvdb, officialSite, summary, url` |

The `id` column from `search` round-trips into `show`.

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Title or fragment to search for |
| `--limit` | Max rows (1–50, default: 20) |

### `show`

| Option | Description |
|--------|-------------|
| `id` (positional) | TVmaze show id (positive integer; visible in `https://www.tvmaze.com/shows/<id>/<slug>`) |

## Notes

- **`summary` is plain text** — TVmaze ships HTML (`<p><b>...</b></p>`); the adapter strips tags and decodes named / decimal / hex HTML entities.
- **`rating` is the TVmaze average** (0–10 scale) or `null` when no rating is recorded.
- **`imdb` / `thetvdb`** are cross-references to other registries — useful for joining with other adapters.
- **`schedule`** combines days + airtime (e.g. `"Sunday 22:00"`); empty string when the show has no fixed schedule.
- **No API key required.** TVmaze caps unauthenticated traffic at ~20 req / 10s — bursts surface as `CommandExecutionError`.
- **Errors.** Bad id / empty query / out-of-range limit → `ArgumentError`; unknown id or no matches → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
