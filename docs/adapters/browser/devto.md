# Dev.to

**Mode**: 🌐 Public · **Domain**: `dev.to`

Fetch the latest and greatest developer articles from the DEV community without needing an API key.

## Commands

| Command | Description |
|---------|-------------|
| `opencli devto top` | Top DEV.to articles of the day |
| `opencli devto latest` | Latest published articles across all tags (paginated) |
| `opencli devto tag <tag>` | Latest articles for a specific tag |
| `opencli devto user <username>` | Recent articles from a specific user |
| `opencli devto read <id>` | Read the body of a single article |

## Listing columns

`top`, `latest`, `tag`, and `user` all surface the same agent-native columns so the
article id is round-trippable into `devto read`:

| Column | Source | Notes |
|--------|--------|-------|
| `rank` | local | 1-indexed position in the result |
| `id` | `item.id` | Numeric article id, feed into `devto read` |
| `title` | `item.title` | |
| `author` | `item.user.username` | (omitted for `user` since it's user-scoped) |
| `reactions` | `item.public_reactions_count` | |
| `comments` | `item.comments_count` | |
| `reading_time` | `item.reading_time_minutes` | Minutes |
| `published_at` | `item.published_at` | ISO 8601 timestamp |
| `tags` | `item.tag_list` | Comma-separated |
| `url` | `item.url` | Canonical article URL |

## `read` columns

`devto read` returns a single row with the article body. DEV.to's public API
does not expose article comments, so this reader does not emit a comment tree.

| Column | Source |
|--------|--------|
| `id` | `article.id` |
| `title` | `article.title` |
| `author` | `article.user.username` |
| `reactions` | `article.public_reactions_count` |
| `reading_time` | `article.reading_time_minutes` |
| `tags` | `article.tag_list` (joined) |
| `published_at` | `article.published_at` |
| `body` | `article.body_markdown` (truncated by `--max-length`) |
| `url` | `article.url` |

## Usage Examples

```bash
# Top articles today
opencli devto top --limit 5

# Latest published articles (newest first; supports --page for pagination)
opencli devto latest --limit 20
opencli devto latest --limit 20 --page 2

# Articles by tag (positional argument)
opencli devto tag javascript
opencli devto tag python --limit 20

# Articles by a specific author
opencli devto user ben
opencli devto user thepracticaldev --limit 5

# Read a single article body by id
opencli devto read 3605688
opencli devto read 3605688 --max-length 5000

# JSON output
opencli devto top -f json
opencli devto read 3605688 -f json
```

## Prerequisites

- No browser required — uses the public DEV.to API
