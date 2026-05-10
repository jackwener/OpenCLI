# npm

**Mode**: 🌐 Public · **Domain**: `registry.npmjs.org` (+ `api.npmjs.org` for download stats)

Search and inspect packages on the public npm registry without auth or browser. Three commands cover discovery, single-package metadata, and download stats.

## Commands

| Command | Description |
|---------|-------------|
| `opencli npm search <query>` | Search the public npm registry by keyword |
| `opencli npm package <name>` | Single-package registry metadata (latest version, license, repo, maintainers) |
| `opencli npm downloads <name>` | Download stats for one package over a fixed period or `YYYY-MM-DD:YYYY-MM-DD` range |

## Usage Examples

```bash
# Search the registry
opencli npm search react --limit 10
opencli npm search "graphql client" --limit 20

# Inspect a single package (use `name` from search rows)
opencli npm package react
opencli npm package @vercel/og

# Download stats for a fixed period
opencli npm downloads react --period last-week
opencli npm downloads react --period last-month
opencli npm downloads react --period last-year

# Custom date range (max 365 days, npm API limit)
opencli npm downloads react --period 2025-01-01:2025-01-31

# JSON output
opencli npm package react -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, name, version, description, weeklyDownloads, dependents, license, publisher, updated, url` |
| `package` | `name, latestVersion, description, license, homepage, repository, bugs, maintainers, keywords, created, modified, url` |
| `downloads` | `rank, package, day, downloads` (range) or `rank, package, day, downloads` for fixed periods (single row, `day` = `last-week:start..end`) |

The `name` column from `search` round-trips into `package` and `downloads`.

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Free-text query (matches name / description / keywords / readme) |
| `--limit` | Max results (1–250, default: 20) |

### `package`

| Option | Description |
|--------|-------------|
| `name` (positional) | npm package name (e.g. `react`, `@vercel/og`). Validates 1–214 chars and the npm naming rule. |

### `downloads`

| Option | Description |
|--------|-------------|
| `name` (positional) | npm package name |
| `--period` | One of `last-day`, `last-week`, `last-month`, `last-year`, **or** a `YYYY-MM-DD:YYYY-MM-DD` range (default: `last-week`) |

## Caveats

- The `--period` argument is validated upfront — anything that's neither one of the four named periods nor a valid `YYYY-MM-DD:YYYY-MM-DD` range raises `ArgumentError` (no silent fallback).
- npm rate-limits the search and download APIs; `HTTP 429` surfaces as a typed `CommandExecutionError` with a retry hint.
- Download stats are intentionally a separate command from `package`. If the stats endpoint fails, the registry-metadata response from `package` is unaffected.
- The package-name regex matches `^(?:@scope\/)?name$` (lowercase letters / digits / `._-`), capped at 214 chars per npm's spec.

## Prerequisites

- No browser required — uses public registry endpoints.
