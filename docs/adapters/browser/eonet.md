# EONET (NASA Earth Observatory Natural Event Tracker)

**Mode**: 🌐 Public · **Domain**: `gsfc.nasa.gov`

Natural event tracking (wildfires, storms, volcanoes, icebergs, floods) from NASA's public REST API at `eonet.gsfc.nasa.gov/api/v3`. No auth, no API key. Use `categories` to discover event types, then filter `events --category <id>`.

## Commands

| Command | Description |
|---------|-------------|
| `opencli eonet events` | Natural events with status / category / lookback filters |
| `opencli eonet categories` | List all event categories (ids round-trip into `events --category`) |

## Usage Examples

```bash
# Recent open events
opencli eonet events --limit 20
opencli eonet events --category wildfires --days 90 --limit 50
opencli eonet events --status closed --days 30

# Category discovery
opencli eonet categories
```

## Output Columns

| Command | Columns |
|---------|---------|
| `events` | `rank, id, title, description, closed, categories, sources, geometryType, lastDate, magnitudeValue, magnitudeUnit, link` |
| `categories` | `rank, id, title, description, link` |

## Options

### `events`

| Option | Description |
|--------|-------------|
| `--limit` | Max rows (1–200, default 20) |
| `--days` | Days back to search (1–365, default 30) |
| `--status` | `open` (active, default) \| `closed` (resolved) \| `all` |
| `--category` | Category id (e.g. `wildfires`, `volcanoes`, `severeStorms`). Use `categories` for the canonical list. |

### `categories`

No options — the category list is small and stable.

## Notes

- **Most-recent geometry is surfaced.** Events have an array of `geometry` entries (one per observation). Adapter takes the last entry for `geometryType / lastDate / magnitudeValue / magnitudeUnit` since that's the freshest snapshot.
- **`closed: null` means still open.** Upstream omits the `closed` timestamp on active events; preserved as `null` rather than coerced to a fake date or empty string.
- **`description: null` is normal.** Many events have no human-readable summary; preserved as `null`.
- **`magnitudeValue` / `magnitudeUnit` are sparse.** Most categories don't carry magnitudes (wildfires usually do via acres burned; storms via wind speed). Both are `null` when not provided — don't assume non-null on filtered queries.
- **`categories` / `sources` joined with comma.** Each event has a small array of category titles and source ids — joined for stable column shape.
- **`categories.id → events --category id`.** The id column round-trips. `categories` returns `wildfires`, `volcanoes`, `severeStorms`, etc. — those are exactly the values `events --category` accepts.
- **Errors.** `--limit` / `--days` out of range → `ArgumentError`; bad `--status` value → `ArgumentError`; empty result for filters → `EmptyResultError`; 429 → `CommandExecutionError`; other non-200 → `CommandExecutionError`.
