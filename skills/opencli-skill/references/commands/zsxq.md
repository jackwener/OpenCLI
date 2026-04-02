# zsxq

## Commands

### dynamics
- Purpose: 获取所有星球的最新动态
- Args:
  - `limit`(optional; type: int; default: 20); Number of dynamics to return
- Usage: `opencli zsxq dynamics [options] -f json`

### groups
- Purpose: 列出当前账号加入的星球
- Args:
  - `limit`(optional; type: int; default: 50); Number of groups to return
- Usage: `opencli zsxq groups [options] -f json`

### search
- Purpose: 搜索星球内容
- Args:
  - `keyword`(required); Search keyword
  - `limit`(optional; type: int; default: 20); Number of results to return
  - `group_id`(optional); Optional group id; defaults to the active group in Chrome
- Usage: `opencli zsxq search [options] -f json`

### topic
- Purpose: 获取单个话题详情和评论
- Args:
  - `id`(required); Topic ID
  - `comment_limit`(optional; type: int; default: 20); Number of comments to fetch
- Usage: `opencli zsxq topic [options] -f json`

### topics
- Purpose: 获取当前星球的话题列表
- Args:
  - `limit`(optional; type: int; default: 20); Number of topics to return
  - `group_id`(optional); Optional group id; defaults to the active group in Chrome
- Usage: `opencli zsxq topics [options] -f json`
