# Xiaoheihe (小黑盒)

**Mode**: 🌐 Public / Browser · **Domain**: `www.xiaoheihe.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli xiaoheihe feed` | Read the community home feed |
| `opencli xiaoheihe hot` | Read community posts sorted by interaction score |
| `opencli xiaoheihe topics` | Read hot communities/topics |
| `opencli xiaoheihe post <post>` | Read one post body and first-screen comments/replies |

## Usage Examples

```bash
# Community feed
opencli xiaoheihe feed --limit 10

# Hot posts
opencli xiaoheihe hot --limit 10

# Topics
opencli xiaoheihe topics --limit 10

# Read a post by id or canonical URL
opencli xiaoheihe post 184169654 --limit 20
opencli xiaoheihe post https://www.xiaoheihe.cn/app/bbs/link/184169654 --limit 5 -f json

# Main post only
opencli xiaoheihe post 184169654 --include-comments false
```

## Notes

- The adapter reads `window.__NUXT__` from public Xiaoheihe pages; no login is required for the currently covered fields.
- `post --limit` controls comments/replies returned after the main post row. The web page hydration state exposes first-screen comment groups, not a full paginated crawl.
- Comment rows may include nested replies. Nested replies use `parentId` and `replyTo` to preserve reply relationships.
- Image content is emitted inline as `[image] <url>` inside `content`.
- `--limit` is validated upfront and raises `ArgumentError` for out-of-range values; it is not silently clamped.

## Output

### `feed` / `hot`

| Column | Type | Notes |
|--------|------|-------|
| `rank` | int | 1-based row position |
| `id` | string | Xiaoheihe post id |
| `title` | string | Post title |
| `description` | string | Short body/description |
| `author` | string | Author name |
| `topic` | string | First topic/community label |
| `likes` | int | Award/up count when present |
| `commentCount` | int | Comment count |
| `createdAt` | string \| null | ISO timestamp |
| `url` | string | Canonical post URL |

### `topics`

| Column | Type | Notes |
|--------|------|-------|
| `rank` | int | Sorted by `hotValue` descending |
| `id` | string | Topic id |
| `name` | string | Topic name |
| `hotValue` | number | Xiaoheihe hot value when present |
| `icon` | string | Topic icon URL |
| `url` | string | Topic URL |

### `post`

| Column | Type | Notes |
|--------|------|-------|
| `type` | string | `post` or `comment` |
| `id` | string | Post id or comment id |
| `parentId` | string \| null | Parent comment id for nested replies |
| `author` | string | Author name |
| `replyTo` | string \| null | Reply target username |
| `title` | string \| null | Present on the main post row |
| `content` | string | Text plus inline image URLs |
| `likes` | int | Award/up count |
| `replyCount` | int | Post comments or comment child count |
| `createdAt` | string \| null | ISO timestamp |
| `ipLocation` | string | IP location label when present |
| `url` | string | Canonical post/comment URL |

## Prerequisites

- Chrome running and able to open `www.xiaoheihe.cn`
- [Browser Bridge extension](/guide/browser-bridge) installed
