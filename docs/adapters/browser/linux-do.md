# LINUX DO

**Mode**: 🔐 Browser · **Domain**: `linux.do`

## Commands

| Command | Description |
|---------|-------------|
| `opencli linux-do feed` | Browse topics (site-wide, by tag, or by category) |
| `opencli linux-do categories` | List all categories |
| `opencli linux-do tags` | List popular tags |
| `opencli linux-do search <query>` | Search topics |
| `opencli linux-do topic <id>` | View topic posts |
| `opencli linux-do user-topics <username>` | Topics created by a user |
| `opencli linux-do user-posts <username>` | Replies posted by a user |

## feed

Browse topic listings. Defaults to latest topics when called with no arguments.

- Supports filtering by `--tag`, `--category`, or both
- `--tag` accepts tag name, slug, or ID
- `--category` accepts category name, slug, ID, or `Parent / Child` path for sub-categories
- Use `--view` to switch between latest / hot / top

### Basic

```bash
# Latest topics (default)
opencli linux-do feed

# Hot topics
opencli linux-do feed --view hot

# Top topics — default period is weekly
opencli linux-do feed --view top
opencli linux-do feed --view top --period daily
opencli linux-do feed --view top --period monthly

# Sort by views descending
opencli linux-do feed --order views

# Sort by created time ascending
opencli linux-do feed --order created --ascending

# Limit results
opencli linux-do feed --limit 10

# JSON output
opencli linux-do feed -f json
```

### Filter by tag

```bash
# By tag name, slug, or ID — all equivalent
opencli linux-do feed --tag "ChatGPT"
opencli linux-do feed --tag chatgpt
opencli linux-do feed --tag 3

# Tag + hot view
opencli linux-do feed --tag "ChatGPT" --view hot

# Tag + top view with period
opencli linux-do feed --tag "OpenAI" --view top --period monthly
```

### Filter by category

Supports both top-level and sub-categories. Sub-categories auto-resolve their parent path.

```bash
# Top-level category — name, slug, or ID
opencli linux-do feed --category "开发调优"
opencli linux-do feed --category develop
opencli linux-do feed --category 4

# Sub-category
opencli linux-do feed --category "开发调优 / Lv1"
opencli linux-do feed --category "网盘资源"

# Category + hot / top view
opencli linux-do feed --category "开发调优" --view hot
opencli linux-do feed --category "开发调优" --view top --period weekly
```

### Category + tag

Combine `--category` and `--tag` to narrow results within a category.

```bash
opencli linux-do feed --category "开发调优" --tag "ChatGPT"
opencli linux-do feed --category "网盘资源" --tag "OpenAI"
opencli linux-do feed --category 94 --tag 4 --view top --period monthly
```

### Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--view V` | `latest`, `hot`, `top` | `latest` |
| `--tag VALUE` | Tag name, slug, or ID | — |
| `--category VALUE` | Category name, slug, or ID | — |
| `--limit N` | Number of results | `20` |
| `--order O` | `default`, `created`, `activity`, `views`, `posts`, `category`, `likes`, `op_likes`, `posters` | `default` |
| `--ascending` | Sort ascending instead of descending | off |
| `--period P` | `all`, `daily`, `weekly`, `monthly`, `quarterly`, `yearly` (only with `--view top`) | `weekly` |

Output columns: `title`, `replies`, `created`, `likes`, `views`, `url`

## categories

List forum categories with optional sub-category expansion.

```bash
opencli linux-do categories
opencli linux-do categories --subcategories
opencli linux-do categories --limit 50
```

When `--subcategories` is enabled, sub-categories are rendered as `Parent / Child` so the `name` value can be copied directly into `opencli linux-do feed --category ...`.

Output columns: `name`, `slug`, `id`, `topics`, `description`

## tags

List tags sorted by usage count.

```bash
opencli linux-do tags
opencli linux-do tags --limit 50
```

Output columns: `rank`, `name`, `count`, `url`

## search

Search topics by keyword.

```bash
opencli linux-do search "NixOS"
opencli linux-do search "Docker" --limit 10
opencli linux-do search "Claude" -f json
```

Output columns: `rank`, `title`, `views`, `likes`, `replies`, `url`

## topic

View posts within a topic (first page).

```bash
opencli linux-do topic 1234
opencli linux-do topic 1234 --limit 50
opencli linux-do topic 1234 --main_only -f json | jq -r '.[0].content'
```

Notes:
- `--main_only` returns only the main post row and keeps the body untruncated

Output columns: `author`, `content`, `likes`, `created_at`

## user-topics

List topics created by a user.

```bash
opencli linux-do user-topics neo
opencli linux-do user-topics neo --limit 10
```

Output columns: `rank`, `title`, `replies`, `created_at`, `likes`, `views`, `url`

## user-posts

List replies posted by a user.

```bash
opencli linux-do user-posts neo
opencli linux-do user-posts neo --limit 10
```

Output columns: `index`, `topic_user`, `topic`, `reply`, `time`, `url`

## Compatibility

The legacy commands below are still available as compatibility wrappers while `feed` becomes the canonical entrypoint:

```bash
opencli linux-do latest
opencli linux-do hot --period weekly
opencli linux-do category develop 4
```

Preferred modern forms:

```bash
opencli linux-do feed --view latest
opencli linux-do feed --view top --period weekly
opencli linux-do feed --category 4
```

## Prerequisites

- Chrome running and **logged into** linux.do
- [Browser Bridge extension](/guide/browser-bridge) installed
