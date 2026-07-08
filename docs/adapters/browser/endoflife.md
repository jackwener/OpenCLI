# endoflife.date

**Mode**: 🌐 Public · **Domain**: `endoflife.date`

Look up release cycles and end-of-life / LTS / support dates for hundreds of products (Node.js, Python, Ubuntu, Java, Postgres, Kubernetes, etc.). Hits the unauthenticated `endoflife.date/api` directly.

## Commands

| Command | Description |
|---------|-------------|
| `opencli endoflife product <name>` | Release cycles + EOL / LTS / support dates for one product |

## Usage Examples

```bash
# Node.js cycles (newest first)
opencli endoflife product nodejs

# Python, JSON output for scripts
opencli endoflife product python -f json

# Ubuntu LTS schedule
opencli endoflife product ubuntu
```

## Output Columns

| Command | Columns |
|---------|---------|
| `product` | `product, cycle, releaseDate, latest, latestReleaseDate, lts, support, eol, extendedSupport, eolStatus, url` |

## Options

### `product`

| Option | Description |
|--------|-------------|
| `product` (positional) | endoflife.date product slug (e.g. `nodejs`, `python`, `ubuntu`, `kubernetes`) |

## Notes

- **`eolStatus`** is a derived projection (`active` / `eol` / `ongoing` / `null`) computed against today's UTC date — agents can answer "is this version still supported?" without parsing dates.
- **Boolean dates → strings.** endoflife.date sometimes ships `true` for "ongoing support" / `false` for "no LTS". The adapter normalises:
  - `true` → `"ongoing"`
  - `false` / `null` → `null`
  - ISO date string → returned as-is
- **No API key required.** Slugs are exactly what appears at `https://endoflife.date/<product>`.
- **Errors.** Bad slug shape → `ArgumentError`; unknown product → `EmptyResultError` (HTTP 404); rate-limited → `CommandExecutionError`.
