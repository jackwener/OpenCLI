# CLS (财联社)

**Mode**: 🌐 Public · **Domain**: `www.cls.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli cls telegraph` | 财联社电报快讯列表 |
| `opencli cls hot` | 财联社首页热门文章 |
| `opencli cls subjects` | 财联社首页热门话题 |
| `opencli cls plates` | 财联社首页热门板块和主力资金 |
| `opencli cls calendar` | 财联社首页投资日历事件 |
| `opencli cls article <id-or-url>` | 财联社文章详情正文 |

## Usage Examples

```bash
# Latest telegraph items
opencli cls telegraph --limit 10

# Homepage hot articles
opencli cls hot --limit 10

# Popular subjects
opencli cls subjects --limit 10

# Hot plates / market sectors
opencli cls plates --limit 10

# Investment calendar
opencli cls calendar --limit 20

# Read an article by ID
opencli cls article 2411505

# Read an article by URL
opencli cls article https://www.cls.cn/detail/2411505

# JSON output
opencli cls telegraph --limit 3 -f json
```

## Notes

- `telegraph` uses the public `api/cache?name=telegraph` JSON cache and does not require a browser session.
- `hot`, `subjects`, `plates`, and `calendar` read public data from the homepage Next.js state.
- `article` fetches the public detail page and reads the article payload from the page's Next.js state.
- `depth` is not included yet because the visible web page uses signed internal endpoints for that list.
