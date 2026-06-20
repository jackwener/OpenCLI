# Internet Archive

**Mode**: 🌐 Public · **Domain**: `archive.org`

## Commands

| Command | Description |
|---------|-------------|
| `opencli archive search <query>` | Search Internet Archive items across books, movies, audio, software, and web |
| `opencli archive item <identifier>` | Fetch metadata for a single Internet Archive item by identifier |
| `opencli archive wayback <url>` | Look up the closest Wayback Machine snapshot for a URL |
| `opencli archive snapshots <url>` | List Wayback Machine snapshots over time for a URL via the CDX API |

## Usage Examples

```bash
# Full-text search across all mediatypes (default sort by downloads)
opencli archive search "machine learning" --limit 10

# Restrict to a mediatype
opencli archive search "newton principia" --mediatype texts --limit 5
opencli archive search "moon landing" --mediatype movies --sort date --limit 5

# Single item metadata
opencli archive item open-syllabus
opencli archive item FinalFantasy2_356

# Closest Wayback snapshot, optionally near a date
opencli archive wayback wikipedia.org
opencli archive wayback wikipedia.org --timestamp 2015

# Wayback CDX history for a URL
opencli archive snapshots wikipedia.org --limit 20
opencli archive snapshots wikipedia.org --from 2010 --to 2015 --limit 50

# JSON output
opencli archive search "machine learning" -f json
```

### `search` Options

| Option | Description |
|--------|-------------|
| `query` (positional) | Full-text query (matches title, description, creator, subject) |
| `--mediatype` | `texts` / `movies` / `audio` / `software` / `image` / `web` / `data` / `collection` |
| `--sort` | `downloads` (default) / `date` / `addeddate` / `week` / `title` |
| `--limit` | Max items (1-100, default: 20) |

Returns rows with `rank, identifier, title, creator, date, mediatype, downloads, url`. The `identifier` round-trips into `opencli archive item <identifier>`.

### `item` Options

| Option | Description |
|--------|-------------|
| `identifier` (positional) | Archive item identifier (letters, digits, ".", "_", "-") |

Returns one row with `identifier, title, creator, date, mediatype, collection, description, file_count, url`.

### `wayback` Options

| Option | Description |
|--------|-------------|
| `url` (positional) | URL to look up (with or without scheme) |
| `--timestamp` | Target timestamp (`YYYY[MM[DD[hh[mm[ss]]]]]` or ISO date). Defaults to most recent snapshot |

Returns one row with `original_url, requested_timestamp, snapshot_timestamp, snapshot_url, status`. The `snapshot_url` round-trips into a regular browser fetch.

### `snapshots` Options

| Option | Description |
|--------|-------------|
| `url` (positional) | URL to look up (with or without scheme) |
| `--from` | Earliest digit-only timestamp |
| `--to` | Latest digit-only timestamp |
| `--limit` | Max snapshots (1-1000, default: 20) |

Returns rows with `timestamp, snapshot_url, status, mimetype, original_url`. Each `snapshot_url` is a direct Wayback Machine permalink. The CDX endpoint is served over HTTP only; the HTTPS endpoint returns 503 in practice.

## Prerequisites

- No browser required; uses public archive.org APIs (Advanced Search, Metadata, Wayback Available, CDX).
