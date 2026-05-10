# Go Module Proxy

**Mode**: 🌐 Public · **Domain**: `proxy.golang.org`

Fetch latest version + VCS origin metadata or list every published version tag for a Go module. Hits the unauthenticated Go module proxy (the canonical mirror used by `GOPROXY`).

## Commands

| Command | Description |
|---------|-------------|
| `opencli goproxy module <path>` | Latest version + VCS origin metadata for a Go module |
| `opencli goproxy versions <path>` | Published version tags for a Go module (newest first) |

## Usage Examples

```bash
# Latest released version of a module
opencli goproxy module github.com/gin-gonic/gin
opencli goproxy module golang.org/x/net

# Every published tag, semver-sorted (descending)
opencli goproxy versions github.com/gin-gonic/gin

# Larger window
opencli goproxy versions github.com/spf13/cobra --limit 100

# Include publish times (one extra request per row)
opencli goproxy versions golang.org/x/net --limit 10 --with-time
```

## Output Columns

| Command | Columns |
|---------|---------|
| `module` | `module, version, publishedAt, vcs, repository, commit, ref, pkgGoDevUrl, url` |
| `versions` | `rank, module, version, publishedAt, url` |

The `module` column round-trips between commands; the `version` column from `versions` round-trips into `goproxy module`'s `version` field.

## Options

### `module`

| Option | Description |
|--------|-------------|
| `module` (positional) | Go module path (e.g. `github.com/gin-gonic/gin`, `golang.org/x/net`) |

### `versions`

| Option | Description |
|--------|-------------|
| `module` (positional) | Go module path |
| `--limit` | Max rows to return (1–200, default: 30) |
| `--with-time` | Fetch each version's publish time (one extra request per row, slower but adds the `publishedAt` column) |

## Notes

- **Module paths must be canonical.** Use what appears in your `go.mod` (host/path/...). The adapter rejects bare names without a host segment.
- **Pre-release tags sort lower than releases.** The default sort is descending semver; `v2.0.0` > `v1.10.1` > `v1.10.0` > `v1.9.0` (NOT alphabetic).
- **`publishedAt` is `null` by default** for `versions` to keep the request count at 1. Use `--with-time` only when you actually need the dates.
- **`module` returns the proxy's resolved upstream** — `vcs` (e.g. `git`), the actual repo URL, the resolved commit hash, and the tag/ref. Useful when a module path doesn't obviously map to a GitHub repo (`golang.org/x/net` → `go.googlesource.com/net`).
- **No API key required.** HTTP 404 / 410 (gone, e.g. retracted modules) → `EmptyResultError`; 429 → `CommandExecutionError`.
- **Errors.** Malformed module path or bad limit → `ArgumentError`; unknown module → `EmptyResultError`; transport / non-200 → `CommandExecutionError`.
