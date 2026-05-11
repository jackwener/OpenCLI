# Maven Central

**Mode**: 🌐 Public · **Domain**: `search.maven.org`

Search Maven Central artifacts and pull per-artifact version histories without auth or browser. Two commands.

## Commands

| Command | Description |
|---------|-------------|
| `opencli maven search <query>` | Search Maven Central by keyword (artifact name, groupId, tag) |
| `opencli maven artifact <coordinate>` | Version history for `groupId:artifactId[:version]` |

## Usage Examples

```bash
# Free-text search
opencli maven search jackson --limit 10
opencli maven search "ai.koog" --limit 5

# Version history for a specific artifact (use `coordinate` from search rows)
opencli maven artifact com.fasterxml.jackson.core:jackson-databind --limit 10
opencli maven artifact com.google.guava:guava --limit 5

# Pin to a specific version
opencli maven artifact com.google.guava:guava:33.0.0-jre

# JSON output
opencli maven search jackson -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search`   | `rank, coordinate, groupId, artifactId, latestVersion, packaging, versions, lastPublished, repository, url` |
| `artifact` | `groupId, artifactId, version, packaging, publishedAt, tags, url` |

The `coordinate` column from `search` round-trips into `artifact` exactly. To pin a single version, append `:<version>`.

## Options

### `maven search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Free-text query |
| `--limit` | Max artifacts (1-200, default: 30) |

### `maven artifact`

| Option | Description |
|--------|-------------|
| `coordinate` (positional) | `groupId:artifactId` or `groupId:artifactId:version` |
| `--limit` | Max versions (1-200, default: 20). Ignored when `version` is pinned. |

## Caveats

- Coordinates are validated upfront — `groupId` and `artifactId` must be `[A-Za-z0-9][A-Za-z0-9._-]*` (max 200 chars each). Bad input raises `ArgumentError`.
- `lastPublished` / `publishedAt` are derived from Solr's epoch-ms `timestamp` and rendered as second-precision `YYYY-MM-DDTHH:MM:SSZ`.
- Maven Central throttles bursts; `HTTP 429` surfaces as a typed `CommandExecutionError` with a retry hint.
- `versions` (in `search`) is the count Solr reports — it includes pre-releases as well as stable versions.

## Prerequisites

- No browser required — uses `search.maven.org/solrsearch/select` (Solr endpoint).
