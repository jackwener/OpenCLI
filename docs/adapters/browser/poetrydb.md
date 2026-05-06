# PoetryDB

**Mode**: 🌐 Public · **Domain**: `poetrydb.org`

A free, no-auth poetry database. Search by author or title, or pull random poems.

## Commands

| Command | Description |
|---------|-------------|
| `opencli poetrydb search` | Search poems by author and/or title |
| `opencli poetrydb random` | N random poems (returns full text) |

## Usage Examples

```bash
# Author only
opencli poetrydb search --author Shakespeare --limit 5

# Title only
opencli poetrydb search --title "Sonnet 18"

# Author + title (must match both)
opencli poetrydb search --author Shakespeare --title Sonnet --limit 10

# Random
opencli poetrydb random
opencli poetrydb random --count 5
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, title, author, lineCount, firstLine, lastLine, text` |
| `random` | `rank, title, author, lineCount, firstLine, lastLine, text` |

## Options

### `search`

| Option | Description |
|--------|-------------|
| `--author` | Author name (full or partial) |
| `--title` | Poem title (full or partial) |
| `--limit` | Max rows (1–200, default: 50) |

At least one of `--author` or `--title` is required.

### `random`

| Option | Description |
|--------|-------------|
| `--count` | Number of random poems (1–50, default: 1) |

## Notes

- **`text`** joins `lines[]` with `\n`, so `--format json` preserves stanza breaks faithfully and shell pretty-printing wraps cleanly.
- **`lineCount`** comes from PoetryDB's own `linecount` field, parsed to an integer.
- **404-wrapped not-found.** PoetryDB returns HTTP 200 with body `{"status":404,"reason":"Not found"}` for empty searches — the adapter promotes this to `EmptyResultError` rather than letting it slip through as a single empty row.
- **No API key.** Public endpoint; bursts may rate-limit and surface as `CommandExecutionError`.
- **Errors.** Missing both `--author` and `--title` / out-of-range limits → `ArgumentError`; no matches / 404-wrapped body → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
