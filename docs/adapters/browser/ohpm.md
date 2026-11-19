# OHPM

**Mode**: 🌐 Public · **Domain**: `ohpm.openharmony.cn`

Search and inspect OpenHarmony/HarmonyOS third-party packages from the public OHPM registry. The adapter uses the same unauthenticated JSON endpoints as `https://ohpm.openharmony.cn/`, so no browser session or login is required.

## Commands

| Command | Description |
|---------|-------------|
| `opencli ohpm search <query>` | Search OpenHarmony OHPM third-party packages by keyword |
| `opencli ohpm package <name>` | Single OHPM package metadata (version, downloads, license, repository) |
| `opencli ohpm dependents <name>` | List packages that depend on an OHPM package |
| `opencli ohpm keywords` | List hot OHPM search keywords |

## Usage Examples

```bash
# Search packages
opencli ohpm search axios --limit 10
opencli ohpm search json --sort latest

# Inspect a single package (use `name` from search rows)
opencli ohpm package @ohos/axios
opencli ohpm package @ohos/axios --version 2.2.10

# Reverse dependencies
opencli ohpm dependents @ohos/axios --limit 20

# Home-page hot keywords
opencli ohpm keywords

# JSON output
opencli ohpm package @ohos/axios -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, name, latestVersion, description, license, keywords, likes, points, popularity, publisher, org, published, url` |
| `package` | `name, version, description, license, downloads, likes, points, popularity, fileSize, fileCount, repository, keywords, publisher, org, dependencies, devDependencies, dependents, versions, published, url` |
| `dependents` | `rank, name, version, dependent, url` |
| `keywords` | `rank, keyword` |

The `name` column from `search` round-trips into `package` and `dependents`.

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Free-text search query |
| `--limit` | Max results (1-50, default: 20) |
| `--sort` | One of `relevancy`, `likes`, `latest` (default: `relevancy`). Aliases: `popular` → `likes`, `newest` → `latest`. |

### `package`

| Option | Description |
|--------|-------------|
| `name` (positional) | OHPM package name (e.g. `@ohos/axios`) |
| `--version` | Package version; omit for latest |

### `dependents`

| Option | Description |
|--------|-------------|
| `name` (positional) | OHPM package name |
| `--version` | Package version; omit for latest |
| `--limit` | Max dependents (1-50, default: 20) |

## Caveats

- The OHPM public API currently accepts `sortedType` values `relevancy`, `likes`, and `latest`. Unsupported values such as `download` are rejected by the server and surfaced as typed command errors.
- Some package detail responses omit `description`; latest-package lookups fill it from the exact package row in search metadata when available.
- `dependents` returns the first page exposed by the package detail endpoint.

## Prerequisites

- No browser required — uses public OHPM registry endpoints.
