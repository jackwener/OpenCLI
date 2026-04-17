# Weibo (微博)

**Mode**: 🔐 Browser · **Domain**: `weibo.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli weibo hot` | 微博热搜 |
| `opencli weibo search` | Search Weibo posts by keyword |
| `opencli weibo feed` | 首页时间线（`for-you` / `following`） |
| `opencli weibo user` | 用户信息 |
| `opencli weibo me` | 我的信息 |
| `opencli weibo post` | 发微博 |
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

# Verbose mode
opencli weibo hot -v
```

## Prerequisites

- Chrome running and **logged into** weibo.com
- [Browser Bridge extension](/guide/browser-bridge) installed
