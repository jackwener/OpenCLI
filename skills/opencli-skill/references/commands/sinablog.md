# sinablog

## Commands

### article
- Purpose: Get a Sina Blog article detail
- Args:
  - `url`(required); 文章URL（如 https://blog.sina.com.cn/s/blog_xxx.html）
- Usage: `opencli sinablog article [options] -f json`

### hot
- Purpose: Get Sina Blog hot/recommended posts
- Args:
  - `limit`(optional; type: int; default: 20); 返回的文章数量
- Usage: `opencli sinablog hot [options] -f json`

### search
- Purpose: Search Sina Blog posts (via Sina search)
- Args:
  - `keyword`(required); 搜索关键词
  - `limit`(optional; type: int; default: 20); 返回的文章数量
- Usage: `opencli sinablog search [options] -f json`

### user
- Purpose: List posts from a Sina Blog user
- Args:
  - `uid`(required); 新浪博客用户ID（如 1234567890）
  - `limit`(optional; type: int; default: 20); 返回的文章数量
- Usage: `opencli sinablog user [options] -f json`
