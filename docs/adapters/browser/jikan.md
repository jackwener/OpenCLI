# Jikan

**Mode**: 🌐 Public · **Domain**: `api.jikan.moe`

Unofficial MyAnimeList REST API (Jikan v4). No auth, no signup — caps at ~3 req/sec.

## Commands

| Command | Description |
|---------|-------------|
| `opencli jikan anime <query>` | Search MAL anime by title (returns mal_id, score, episodes, studios) |
| `opencli jikan manga <query>` | Search MAL manga by title (returns mal_id, chapters/volumes, authors) |

## Usage Examples

```bash
# Anime search
opencli jikan anime "cowboy bebop"
opencli jikan anime attack --limit 10

# Manga search
opencli jikan manga berserk
opencli jikan manga "vagabond" --limit 5
```

## Output Columns

| Command | Columns |
|---------|---------|
| `anime` | `rank, malId, title, titleEnglish, titleJapanese, type, episodes, status, aired, duration, rating, score, scoredBy, malRank, popularity, genres, studios, url` |
| `manga` | `rank, malId, title, titleEnglish, titleJapanese, type, chapters, volumes, status, published, score, scoredBy, malRank, popularity, genres, authors, url` |

## Options

### `anime` / `manga`

| Option | Description |
|--------|-------------|
| `query` (positional) | Title or fragment |
| `--limit` | Max rows (1–25, default 25 — Jikan's hard per-page cap) |

## Notes

- **`malId`** is the canonical MyAnimeList id and round-trips into the upstream MAL URL (also exposed as `url`). Useful as a stable join key for cross-tool workflows.
- **`score` / `scoredBy`** come straight from MAL's user voting; `score` is `null` (not 0) when an entry has no votes, never silently coerced.
- **`genres` / `studios` / `authors`** are joined from Jikan's `[{name, ...}]` arrays with `, ` (max 5 to keep rows readable); empty string when MAL has no entries.
- **Rate limit.** Jikan caps free traffic at ~3 req/sec; bursts return HTTP 429 → `CommandExecutionError` with a clear message.
- **Errors.** Empty query / out-of-range limit → `ArgumentError`; no matches / 404 → `EmptyResultError`; rate-limit / transport / non-200 → `CommandExecutionError`.
