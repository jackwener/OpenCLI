# Open Library

**Mode**: 🌐 Public · **Domain**: `openlibrary.org`

Search Open Library's catalog and resolve full work details by OLID or ISBN. Public REST API, no auth.

## Commands

| Command | Description |
|---------|-------------|
| `opencli openlibrary search <query>` | Free-text search (returns OLID + title + author + cover) |
| `opencli openlibrary work <ref>` | Work detail by OLID (`OL\d+W`) or ISBN (10/13) |

## Usage Examples

```bash
# Search
opencli openlibrary search "fantastic mr fox" --limit 5
opencli openlibrary search "roald dahl"

# Work by OLID (round-trips from search)
opencli openlibrary work OL45804W

# Work by ISBN (auto-resolves edition → work in two fetches)
opencli openlibrary work 9780140328721
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, olid, title, firstAuthor, firstPublishYear, editionCount, isbnCount, subjects, language, coverUrl, url` |
| `work` | `olid, title, firstPublishDate, authorOlids, subjects, subjectPlaces, subjectTimes, description, coverUrl, url` |

The `olid` column from `search` round-trips into `work`.

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Title, author, or keyword |
| `--limit` | Max rows (1–100, default: 20) |

### `work`

| Option | Description |
|--------|-------------|
| `ref` (positional) | OLID (`OL\d+W` for works) or ISBN-10 / ISBN-13 |

## Notes

- **Explicit `fields=` projection on search.** Without it, Open Library silently drops `isbn`, `subject`, and other "expensive" fields from the response — leaving the corresponding columns empty (silent-empty-column trap). The adapter opts in so every column populates.
- **ISBN → work resolution.** `work <isbn>` does two fetches: `/isbn/<isbn>.json` → `works[0].key` → `/works/<OLID>.json`. The output `olid` always reflects the canonical work, regardless of which input form you used.
- **`description`** is normalized — Open Library sometimes returns a string, sometimes `{value: "..."}`; the adapter unwraps both.
- **`authorOlids`** joins all author OLIDs (`OL\d+A`) with `, ` so you can fan out to author detail later.
- **`coverUrl`** is the large-format cover (`-L.jpg`) when a cover exists; empty string otherwise — never a broken placeholder URL.
- **Errors.** Empty query / unrecognized ref / non-OLID-non-ISBN / out-of-range limit → `ArgumentError`; 404 / no docs → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
