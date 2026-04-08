# medium

## Commands

### feed
- Purpose: Medium trending feed
- Args:
  - `topic`(optional; default: ''); 话题标签（如 technology, programming, ai）
  - `limit`(optional; type: int; default: 20); 返回的文章数量
- Usage: `opencli medium feed [options] -f json`

### search
- Purpose: Search Medium articles
- Args:
  - `keyword`(required); 搜索关键词
  - `limit`(optional; type: int; default: 20); 返回的文章数量
- Usage: `opencli medium search [options] -f json`

### user
- Purpose: List articles from a Medium user
- Args:
  - `username`(required); Medium 用户名（如 @username 或 username）
  - `limit`(optional; type: int; default: 20); 返回的文章数量
- Usage: `opencli medium user [options] -f json`
