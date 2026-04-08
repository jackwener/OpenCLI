# linux-do

## Commands

### categories
- Purpose: linux.do category list
- Args: None
- Usage: `opencli linux-do categories [options] -f json`

### category
- Purpose: linux.do topics in a category
- Args:
  - `slug`(required; type: str); Category slug (legacy compatibility argument)
  - `id`(required; type: int); Category ID
  - `limit`(optional; type: int; default: 20); Number of items (per_page)
- Usage: `opencli linux-do category [options] -f json`

### feed
- Purpose: linux.do 话题列表（需登录；支持全站、标签、分类）
- Args: None
- Usage: `opencli linux-do feed [options] -f json`

### hot
- Purpose: linux.do hot topics
- Args:
  - `limit`(optional; type: int; default: 20); Number of items (per_page)
  - `period`(optional; type: str; default: 'weekly'); Time period
- Usage: `opencli linux-do hot [options] -f json`

### latest
- Purpose: linux.do latest topics
- Args:
  - `limit`(optional; type: int; default: 20); Number of items (per_page)
- Usage: `opencli linux-do latest [options] -f json`

### search
- Purpose: Search linux.do
- Args: None
- Usage: `opencli linux-do search [options] -f json`

### tags
- Purpose: linux.do 标签列表
- Args: None
- Usage: `opencli linux-do tags [options] -f json`

### topic
- Purpose: linux.do topic detail with replies (homepage scope)
- Args: None
- Usage: `opencli linux-do topic [options] -f json`

### topic-content
- Purpose: Get the main topic body as Markdown
- Args:
  - `id`(required; type: int); Topic ID
- Usage: `opencli linux-do topic-content [options] -f json`

### user-posts
- Purpose: linux.do 用户的帖子
- Args: None
- Usage: `opencli linux-do user-posts [options] -f json`

### user-topics
- Purpose: linux.do 用户创建的话题
- Args: None
- Usage: `opencli linux-do user-topics [options] -f json`
