# substack

## Commands

### feed
- Purpose: Substack trending feed
- Args:
  - `category`(optional; default: 'all'); 文章分类: all, tech, business, culture, politics, science, health
  - `limit`(optional; type: int; default: 20); 返回的文章数量
- Usage: `opencli substack feed [options] -f json`

### publication
- Purpose: Get latest posts from a specific Substack newsletter
- Args:
  - `url`(required); Newsletter URL（如 https://example.substack.com）
  - `limit`(optional; type: int; default: 20); 返回的文章数量
- Usage: `opencli substack publication [options] -f json`

### search
- Purpose: Search Substack posts and newsletters
- Args:
  - `keyword`(required); 搜索关键词
  - `type`(optional; default: 'posts'); 搜索类型（posts=文章, publications=Newsletter）
  - `limit`(optional; type: int; default: 20); 返回结果数量
- Usage: `opencli substack search [options] -f json`
