# Docker Hub

**Mode**: 🌐 Public · **Domain**: `hub.docker.com`

Search and inspect public Docker Hub repositories without auth or browser. Two commands cover discovery and per-repository metadata.

## Commands

| Command | Description |
|---------|-------------|
| `opencli dockerhub search <query>` | Search Docker Hub repositories by keyword |
| `opencli dockerhub image <name>` | Repository metadata (stars, pulls, last updated, status) |

## Usage Examples

```bash
# Search repositories
opencli dockerhub search nginx --limit 10
opencli dockerhub search "bitnami redis" --limit 5

# Single repository metadata (use `image` from search rows)
opencli dockerhub image nginx              # implicit `library/nginx`
opencli dockerhub image library/nginx
opencli dockerhub image bitnami/redis

# JSON output
opencli dockerhub search nginx -f json
opencli dockerhub image nginx -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `search` | `rank, image, official, stars, pulls, description, url` |
| `image`  | `image, official, stars, pulls, description, lastUpdated, lastModified, registered, status, url` |

The `image` column from `search` round-trips into `image` exactly. Bare repository names (e.g. `nginx`) resolve to the implicit `library` owner that Docker Hub uses for official images.

## Options

### `dockerhub search`

| Option | Description |
|--------|-------------|
| `query` (positional) | Search keyword |
| `--limit` | Max repositories (1-100, default: 25) |

### `dockerhub image`

| Option | Description |
|--------|-------------|
| `image` (positional) | Repository slug (`nginx`, `library/nginx`, `bitnami/redis`) |

## Caveats

- Image slugs are validated upfront against Docker Hub's `[a-z0-9][a-z0-9._-]*` pattern (2-255 chars). Bad input raises `ArgumentError`.
- Anonymous traffic is throttled. `HTTP 429` surfaces as a typed `CommandExecutionError` with a retry hint.
- Timestamp columns (`lastUpdated`, `lastModified`, `registered`) are normalized to second-precision `YYYY-MM-DDTHH:MM:SSZ`.

## Prerequisites

- No browser required — uses `hub.docker.com/v2/search/repositories/` and `hub.docker.com/v2/repositories/<owner>/<name>/`.
