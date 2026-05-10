# Lobsters

**Mode**: 🌐 Public · **Domain**: `lobste.rs`

## Commands

| Command | Description |
|---------|-------------|
| `opencli lobsters hot` | Hottest stories |
| `opencli lobsters newest` | Latest stories |
| `opencli lobsters active` | Most active discussions |
| `opencli lobsters tag <tag>` | Stories by tag |
| `opencli lobsters domain <domain>` | Stories submitted from a specific source domain |
| `opencli lobsters read <short_id>` | Read a story and its comment tree |

## Usage Examples

```bash
# Quick start
opencli lobsters hot --limit 10

# Filter by tag
opencli lobsters tag rust --limit 5

# Stories from a specific source domain
opencli lobsters domain github.com --limit 10
opencli lobsters domain arxiv.org --limit 5

# Read a specific story (use the short_id surfaced as `id` in any listing)
opencli lobsters read 6cmh6h --limit 25 --depth 2

# JSON output
opencli lobsters hot -f json
```

## Output Columns

| Command | Columns |
|---------|---------|
| `hot` / `newest` / `active` / `tag` | `rank, id, title, score, author, comments, created_at, tags, url` |
| `domain` | `rank, id, title, score, author, comments, created_at, tags, submission_url, comments_url` |
| `read` | `type, author, score, text` (POST + L0/L1/… comments, with `[+N more replies]` stubs) |

`id` is the lobste.rs `short_id` — pipe it into `read` to drill into the discussion.

`domain` returns both `submission_url` (the underlying article URL on the source site) and `comments_url` (the lobste.rs discussion page). The legacy listing commands collapse these into a single `url` (= `comments_url`).

## Prerequisites

None — all commands use the public JSON API, no browser or login required.
