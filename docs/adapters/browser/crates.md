# crates.io

**Mode**: 🌐 Public · **Domain**: `crates.io`

Search and inspect crates on the public Rust crate registry. Both commands hit the unauthenticated `crates.io/api/v1` directly.

## Commands

| Command | Description |
|---------|-------------|
| `opencli crates search <query>` | Search the public crates.io registry by keyword |
| `opencli crates crate <name>` | Single crate metadata (latest version, downloads, license, repo) |

## Usage Examples

```bash
# Free-text search (name / keywords / description)
opencli crates search tokio --limit 10
opencli crates search "async runtime" --limit 20

# Single-crate detail (name from search rows)
opencli crates crate serde
opencli crates crate tokio

# JSON output
opencli crates search tokio -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, name, latestVersion, description, downloads, recentDownloads, repository, updated, url` |
| `crate` | `name, latestVersion, description, downloads, recentDownloads, versions, license, homepage, documentation, repository, keywords, categories, created, updated, url` |

The `name` column from `search` round-trips into `crate`.

## Options

### `search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Free-text search query |
| `--limit` | Max results (1–100, default: 20). 100 is crates.io's per-page upper bound. |

### `crate`

| Option | Description |
|--------|-------------|
| `name` (positional) | crates.io crate name (e.g. `serde`, `tokio`). Must match Rust's identifier rule. |

## Caveats

- crates.io requires a descriptive `User-Agent` per [the data-access policy](https://crates.io/data-access). The adapter sets one automatically.
- `license` is sourced from the **latest version row** in the package's version index — crate-level metadata does not carry a license field.
- `recentDownloads` is the rolling 90-day count exposed by the API; `downloads` is the lifetime total.
- `keywords` and `categories` are joined with `, ` for display.

## Prerequisites

- No browser required — uses `crates.io/api/v1`.
