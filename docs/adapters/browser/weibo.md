# Weibo (微博)

**Mode**: 🔐 Browser · **Domain**: `weibo.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli weibo hot` | 微博热搜 |
| `opencli weibo search` | Search Weibo posts by keyword |
| `opencli weibo feed` | 首页时间线（`for-you` / `following`） |
| `opencli weibo user` | 用户信息 |
| `opencli weibo user-posts` | 按用户列出微博，可选日期范围 |
| `opencli weibo me` | 我的信息 |
| `opencli weibo post` | 发微博 |
| `opencli weibo favorites` | 我的微博收藏列表 |
| `opencli weibo publish` | 通过网页 UI 直接发布微博，支持最多 9 张图片 |
| `opencli weibo comments` | 微博评论 |

## Usage Examples

```bash
# Quick start
opencli weibo hot --limit 5

# JSON output
opencli weibo hot -f json

# Search
opencli weibo search "OpenAI" --limit 5

# Home timeline (default: for-you / 推荐流)
opencli weibo feed --limit 10

# Following-only timeline (strict chronological following feed)
opencli weibo feed --type following --limit 10

# Read a post from feed/search using the emitted id
opencli weibo post <id>

# List a user's posts by uid or screen name
opencli weibo user-posts 1670458304 --start 2025-06-01 --end 2025-06-02 --limit 20

# Verbose mode
opencli weibo hot -v

# Favorites
opencli weibo favorites --limit 20

# Publish text (executes immediately)
opencli weibo publish "Hello from OpenCLI"

# Publish text with images (executes immediately)
opencli weibo publish "Hello with images" --images /path/a.jpg,/path/b.png
```

## Listing Columns

`feed`, `search`, and `user-posts` expose `id` for post rows. Pass that value
directly to `opencli weibo post <id>`. `hot` rows are search topics, not post
rows.

## Prerequisites

- Chrome running and **logged into** weibo.com
- [Browser Bridge extension](/guide/browser-bridge) installed
