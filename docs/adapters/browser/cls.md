# CLS (财联社)

**Mode**: 🌐 Public · **Domain**: `www.cls.cn`

## Commands

| Command | Description |
|---------|-------------|
| `opencli cls telegraph` | 财联社电报快讯列表 |
| `opencli cls article <id-or-url>` | 财联社文章详情正文 |

## Usage Examples

```bash
# Latest telegraph items
opencli cls telegraph --limit 10

# Read an article by ID
opencli cls article 2411505

# Read an article by URL
opencli cls article https://www.cls.cn/detail/2411505

# JSON output
opencli cls telegraph --limit 3 -f json
```

## Notes

- `telegraph` uses the public `api/cache?name=telegraph` JSON cache and does not require a browser session.
- `article` fetches the public detail page and reads the article payload from the page's Next.js state.
- `depth` is not included yet because the visible web page uses signed internal endpoints for that list.
