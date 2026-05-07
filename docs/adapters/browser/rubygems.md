# RubyGems

**Mode**: 🌐 Public · **Domain**: `rubygems.org`

Search and inspect Ruby gems on the public RubyGems.org index without auth or browser. Two commands cover discovery and per-gem metadata.

## Commands

| Command | Description |
|---------|-------------|
| `opencli rubygems search <query>` | Search RubyGems.org gems by keyword |
| `opencli rubygems gem <name>` | Single-gem metadata (version, downloads, license, links) |

## Usage Examples

```bash
# Search gems
opencli rubygems search rails --limit 10
opencli rubygems search redis --limit 5

# Single-gem metadata (use `gem` from search rows)
opencli rubygems gem rails
opencli rubygems gem sidekiq

# JSON output
opencli rubygems search rails -f json
opencli rubygems gem rails -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, gem, version, downloads, license, authors, info, url` |
| `gem`    | `gem, version, releasedAt, downloads, versionDownloads, license, authors, homepage, source, bugs, info, url` |

The `gem` column from `search` round-trips into `gem` exactly.

## Options

### `rubygems search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Search keyword |
| `--limit` | Max gems (1-100, default: 30) |

### `rubygems gem`

| Option | Description |
|--------|-------------|
| `name` (positional) | Gem name (`rails`, `sidekiq`, `pundit`) |

## Caveats

- Gem names are validated against RubyGems' own `[A-Za-z0-9][A-Za-z0-9._-]*` pattern (max 100 chars). Bad input raises `ArgumentError`.
- `releasedAt` is normalized to second-precision `YYYY-MM-DDTHH:MM:SSZ`.
- RubyGems throttles bursts; `HTTP 429` surfaces as a typed `CommandExecutionError` with a retry hint.

## Prerequisites

- No browser required — uses `rubygems.org/api/v1/search.json` and `rubygems.org/api/v1/gems/<name>.json`.
