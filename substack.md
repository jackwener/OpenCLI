# Substack

**Mode**: 🌐 Public (search) / 🔐 Browser (feed, publication) · **Domain**: `substack.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli substack feed` | Substack 热门文章 Feed |
| `opencli substack search` | 搜索 Substack 文章和 Newsletter（无需浏览器） |
| `opencli substack publication` | 获取特定 Substack Newsletter 的最新文章 |

## Usage Examples

```bash
# 热门 Feed
opencli substack feed --limit 10

# 按分类浏览
opencli substack feed --category tech --limit 10

# 搜索文章（公开 API，无需浏览器）
opencli substack search "AI"

# 搜索 Newsletter
opencli substack search "technology" --type publications

# 查看特定 Newsletter 的最新文章
opencli substack publication "https://example.substack.com" --limit 10

# JSON output
opencli substack search "AI" -f json
```

## Prerequisites

- `search` command: No login required (public API)
- `feed`, `publication` commands: Chrome with `substack.com` accessible, Browser Bridge extension installed
