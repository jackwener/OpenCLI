# Wikidata

**Mode**: 🌐 Public · **Domain**: `www.wikidata.org`

Search Wikidata items by keyword and fetch full entity detail by Q/P/L identifier. Wikidata is the canonical structured-data registry behind Wikipedia, with ~110M entities and a global property graph.

## Commands

| Command | Description |
|---------|-------------|
| `opencli wikidata search <query>` | Search Wikidata items by label / alias (returns Q-IDs) |
| `opencli wikidata entity <id>` | Full entity detail: label, description, aliases, claim & sitelink counts |

## Usage Examples

```bash
# Find Q-IDs by keyword
opencli wikidata search einstein
opencli wikidata search "san francisco" --limit 10
opencli wikidata search 哈尔滨 --language zh

# Entity detail (Q-IDs round-trip from search)
opencli wikidata entity Q937           # Albert Einstein
opencli wikidata entity Q90            # Paris
opencli wikidata entity Q937 --language zh
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, qid, label, description, matchType, matchText, url` |
| `entity` | `qid, type, label, description, aliases, claimPropertyCount, sitelinkCount, enwikiTitle, modified, url` |

The `qid` column round-trips between commands.

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Search keyword (matches labels and aliases) |
| `--language` | Search & display language (ISO 639, default: `en`). Examples: `en`, `fr`, `zh`, `zh-hans`. |
| `--limit` | Max items (1–50, default: 20) |

### `entity`

| Option | Description |
|--------|-------------|
| `id` (positional) | Entity id: `Q<digits>` (item), `P<digits>` (property), `L<digits>` (lexeme). Full URLs (`https://www.wikidata.org/wiki/Q937`) are stripped. |
| `--language` | Display language (ISO 639, default: `en`). Falls back to English when missing. |

## Notes

- **Label / description / aliases fall back to English** when the requested language is missing — Wikidata stores localisations independently per field, so a Chinese-only article may have an English label but no Chinese description, and we surface what's available rather than emitting `null` row-by-row.
- **`claimPropertyCount` ≠ claim count.** It counts the number of distinct properties (P-IDs) on the entity. Some properties have many statements (e.g. `P31` may have multiple "instance of" claims); we don't sum them. Useful as a rough indicator of how rich the entity is.
- **`sitelinkCount`** is the number of language Wikipedias linking to this entity. High values (300+) indicate broadly-known concepts.
- **`enwikiTitle`** is the corresponding English Wikipedia article title, if any. `null` for entities not linked to enwiki (Q-IDs that exist only as Wikidata structured data).
- **`matchType` (search only)** is one of `label`, `alias`, `description`, indicating how the keyword matched. `alias` matches are common for famous entities (e.g. searching "Einstein" matches Q937 via alias, not label).
- **No API key required.** Wikidata throttles anonymous traffic at ~5000 req/hour; bursts → `CommandExecutionError`.
- **Errors.** Bad Q-ID shape / bad language code / bad limit → `ArgumentError`; unknown id → `EmptyResultError`; transport / 429 / non-200 → `CommandExecutionError`.
