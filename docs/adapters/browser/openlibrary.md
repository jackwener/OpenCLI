# Open Library

**Mode**: 🌐 Public · **Domain**: `openlibrary.org`

Search Open Library by keyword and fetch full work metadata by Open Library work id. Open Library is the Internet Archive's open book registry — every public work has a stable `OL<digits>W` key. No API key required.

## Commands

| Command | Description |
|---------|-------------|
| `opencli openlibrary search <query>` | Open Library books by keyword (title, author, first publish year, ebook access) |
| `opencli openlibrary work <workKey>` | Full Open Library work metadata (description, subjects, ratings, cover ids) |

## Usage Examples

```bash
# Title / author / subject search
opencli openlibrary search "fantastic mr fox"
opencli openlibrary search "ursula le guin" --limit 30

# Work detail (key round-trips from search)
opencli openlibrary work OL45804W
opencli openlibrary work /works/OL45804W                          # courtesy: path form accepted
opencli openlibrary work https://openlibrary.org/works/OL45804W   # courtesy: full URL accepted
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, workKey, title, author, firstPublished, editions, ebook, language, isbn, subjects, coverId, url` |
| `work` | `workKey, title, subtitle, authors, description, subjects, subjectPlaces, subjectPeople, subjectTimes, firstPublished, coverIds, rating, ratingsCount, editionsUrl, url` |

The `workKey` column from `search` round-trips into `work`.

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Search keyword (title / author / subject) |
| `--limit` | Max rows (1–100, default: 20) |

### `work`

| Option | Description |
|--------|-------------|
| `workKey` (positional) | Open Library work key (e.g. `OL45804W`); `/works/<id>` paths and full URLs are stripped automatically. Editions (`OL...M`) and authors (`OL...A`) are rejected. |

## Notes

- **`description` flattens both Open Library description shapes** — sometimes a plain string, sometimes `{type: '/type/text', value: '...'}`. The adapter normalises to a trimmed string and returns `null` when empty.
- **`rating` / `ratingsCount`** come from a sibling endpoint (`/works/<id>/ratings.json`). When ratings 404 (common for niche works), both fields fall back to `null` instead of failing the whole detail request.
- **`subjects`, `subjectPlaces`, `subjectPeople`, `subjectTimes`** are Open Library's three-axis taxonomy. Each column is comma-joined; the column itself is `null` when the work has no entries on that axis.
- **`authors` returns Open Library author keys** (`OL34184A`-style), comma-joined. Open Library doesn't ship author display names on the work payload — agents that need names should call `https://openlibrary.org/authors/<id>.json` directly.
- **`coverIds` is at most 5 ids.** Construct a cover URL with `https://covers.openlibrary.org/b/id/<id>-L.jpg` (`-S`/`-M`/`-L` for size).
- **No API key required.** Open Library throttles unauthenticated traffic; bursts → `CommandExecutionError`.
- **Errors.** Bad work key shape / bad limit → `ArgumentError`; unknown work → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
