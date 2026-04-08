# jike

## Commands

### comment
- Purpose: Comment on a Jike post
- Args:
  - `id`(required; type: string); 帖子 ID
  - `text`(required; type: string); 评论内容
- Usage: `opencli jike comment [options] -f json`

### create
- Purpose: Create a Jike post
- Args:
  - `text`(required; type: string); 动态正文内容
- Usage: `opencli jike create [options] -f json`

### feed
- Purpose: Jike home feed
- Args:
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli jike feed [options] -f json`

### like
- Purpose: Like a Jike post
- Args:
  - `id`(required; type: string); 帖子 ID
- Usage: `opencli jike like [options] -f json`

### notifications
- Purpose: Jike notifications
- Args:
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli jike notifications [options] -f json`

### post
- Purpose: Jike post detail with comments
- Args: None
- Usage: `opencli jike post [options] -f json`

### repost
- Purpose: Repost a Jike post
- Args:
  - `id`(required; type: string); 帖子 ID
  - `text`(optional; type: string); 转发附言（可选）
- Usage: `opencli jike repost [options] -f json`

### search
- Purpose: Search Jike posts
- Args:
  - `query`(required; type: string)
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli jike search [options] -f json`

### topic
- Purpose: Jike topic/circle posts
- Args: None
- Usage: `opencli jike topic [options] -f json`

### user
- Purpose: Jike user posts
- Args: None
- Usage: `opencli jike user [options] -f json`
