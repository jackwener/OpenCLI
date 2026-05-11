# 即刻 (Jike)

**Mode**: 🔐 Browser · **Domain**: `web.okjike.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli jike feed` | 即刻首页动态流 |
| `opencli jike search` | 搜索即刻帖子 |
| `opencli jike post` | 帖子详情及评论 |
| `opencli jike topic` | 话题详情 |
| `opencli jike user` | 用户资料 |
| `opencli jike create` | 发布即刻动态 |
| `opencli jike comment` | 评论即刻帖子 |
| `opencli jike like` | 点赞即刻帖子 |
| `opencli jike repost` | 转发即刻帖子 |
| `opencli jike notifications` | 即刻通知 |

## Usage Examples

```bash
# View feed
opencli jike feed --limit 10

# Search posts
opencli jike search "AI" --limit 20

# View post details and comments
opencli jike post <post-id>

# Create a new post
opencli jike create --content "Hello Jike!"

# Like a post
opencli jike like <post-id>

# JSON output
opencli jike feed -f json
```

## Listing Columns

`feed`, `search`, and `user` expose `id` for each post row. Pass that value
directly to `opencli jike post <id>` for the detail view.

## Prerequisites

- Chrome running and **logged into** web.okjike.com
- [Browser Bridge extension](/guide/browser-bridge) installed
