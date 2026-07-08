# Packagist

**Mode**: 🌐 Public · **Domain**: `packagist.org`

Search and inspect PHP / Composer packages on Packagist without auth or browser. Two commands.

## Commands

| Command | Description |
|---------|-------------|
| `opencli packagist search <query>` | Search Packagist (PHP / Composer) packages by keyword |
| `opencli packagist package <name>` | Single-package metadata (version, downloads, license, repo, GitHub stars) |

## Usage Examples

```bash
# Search packages
opencli packagist search symfony --limit 10
opencli packagist search "laravel http" --limit 5

# Single-package metadata (use `package` from search rows; vendor/package required)
opencli packagist package symfony/console
opencli packagist package laravel/framework
opencli packagist package monolog/monolog

# JSON output
opencli packagist search symfony -f json
opencli packagist package symfony/console -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search`  | `rank, package, description, downloads, favers, repository, url` |
| `package` | `package, version, releasedAt, license, description, repository, githubStars, favers, downloads, monthlyDownloads, dailyDownloads, url` |

The `package` column from `search` round-trips into `package` exactly.

## Options

### `packagist search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Search keyword |
| `--limit` | Max packages (1-100, default: 30) |

### `packagist package`

| Option | Description |
|--------|-------------|
| `name` (positional) | Composer package `<vendor>/<package>` (`symfony/console`, `monolog/monolog`) |

## Caveats

- Composer names are validated upfront — both `vendor` and `package` segments are required, lowercase letters / digits / `_-.` only, max 100 chars per segment. Bad input raises `ArgumentError`.
- `version` is the newest stable release (skipping `*-dev`, `*-rc*`, `*-beta*`, `*-alpha*`). Falls back to the newest available version if no stable exists.
- `releasedAt` is normalized to second-precision `YYYY-MM-DDTHH:MM:SSZ`.
- Packagist throttles bursts; `HTTP 429` surfaces as a typed `CommandExecutionError` with a retry hint.

## Prerequisites

- No browser required — uses `packagist.org/search.json` and `packagist.org/packages/<vendor>/<package>.json`.
