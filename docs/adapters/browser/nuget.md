# NuGet

**Mode**: 🌐 Public · **Domain**: `api.nuget.org`

Search the NuGet package index by keyword and fetch full version history for a package id. NuGet is the canonical .NET package registry; both endpoints are public V3 JSON.

## Commands

| Command | Description |
|---------|-------------|
| `opencli nuget search <query>` | Search NuGet packages by keyword |
| `opencli nuget package <id>` | Full NuGet package version history (catalog entries) |

## Usage Examples

```bash
# Keyword search
opencli nuget search newtonsoft
opencli nuget search "asp.net core" --limit 10
opencli nuget search serilog --prerelease=true

# Full version history (id round-trips from search)
opencli nuget package Newtonsoft.Json
opencli nuget package Serilog
opencli nuget package Microsoft.Extensions.Logging
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, id, version, title, description, authors, tags, totalDownloads, verified, projectUrl, url` |
| `package` | `rank, id, version, title, authors, tags, language, licenseExpression, projectUrl, published, listed, url` |

The `id` column round-trips between commands.

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Search keyword |
| `--limit` | Max packages (1–1000, default: 20) — NuGet's max page size is 1000 |
| `--prerelease` | Include prerelease versions (default: `false`) |

### `package`

| Option | Description |
|--------|-------------|
| `id` (positional) | NuGet package id (case-insensitive). Allowed: 1–100 chars of letters/digits/`.`/`_`/`-`, must start with letter or digit. |

## Notes

- **`package` returns the full version history**, newest-first (sorted by `published` desc, ties broken by version string desc). Each row is one published release. NuGet's CDN paginates internally; the adapter walks pages so even 100+ version histories come back in one call.
- **`listed` flag**: when `false`, the version was unlisted by the publisher (still installable by exact pin, but hidden from search). `null` when NuGet didn't include the field (rare, very old packages).
- **`verified` (search only)**: NuGet's "verified publisher" badge — packages signed by a verified org. Useful for filtering hostile typo-squats.
- **`totalDownloads`** is a single global counter; it does NOT split per-version. For per-version downloads NuGet exposes a different endpoint we don't surface here.
- **`tags` / `authors`** are comma-joined; raw shape is space-separated tags + JSON author array, normalised to consistent comma joins.
- **No API key required.** NuGet's V3 service index is public; no rate limit doc but bursts → `CommandExecutionError`.
- **Errors.** Bad id / bad limit / empty query → `ArgumentError`; unknown package (HTTP 404) → `EmptyResultError`; transport / 429 / non-200 → `CommandExecutionError`.
