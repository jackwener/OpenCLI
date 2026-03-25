# reddit

## Commands

### comment
- 用途：Post a comment on a Reddit post
- 参数：
  - `post-id`（必填）：类型 string；Post ID (e.g. 1abc123) or fullname (t3_xxx)
  - `text`（必填）：类型 string；Comment text
- 用法：`opencli reddit comment [options] -f json`

### frontpage
- 用途：Reddit Frontpage / r/all
- 参数：
  - `limit`（可选）：类型 int；默认值 15
- 用法：`opencli reddit frontpage [options] -f json`

### hot
- 用途：Reddit 热门帖子
- 参数：
  - `subreddit`（可选）：类型 str；默认值 ""；"Subreddit name (e.g. programming). Empty for frontpage"
  - `limit`（可选）：类型 int；默认值 20；Number of posts
- 用法：`opencli reddit hot [options] -f json`

### popular
- 用途：Reddit Popular posts (/r/popular)
- 参数：
  - `limit`（可选）：类型 int；默认值 20
- 用法：`opencli reddit popular [options] -f json`

### read
- 用途：Read a Reddit post and its comments
- 参数：
  - `post-id`（必填）：Post ID (e.g. 1abc123) or full URL
  - `sort`（可选）：默认值 'best'；Comment sort: best, top, new, controversial, old, qa
  - `limit`（可选）：类型 int；默认值 25；Number of top-level comments
  - `depth`（可选）：类型 int；默认值 2；Max reply depth (1=no replies, 2=one level of replies, etc.)
  - `replies`（可选）：类型 int；默认值 5；Max replies shown per comment at each level (sorted by score)
  - `max-length`（可选）：类型 int；默认值 2000；Max characters per comment body (min 100)
- 用法：`opencli reddit read [options] -f json`

### save
- 用途：Save or unsave a Reddit post
- 参数：
  - `post-id`（必填）：类型 string；Post ID (e.g. 1abc123) or fullname (t3_xxx)
  - `undo`（可选）：类型 boolean；默认值 false；Unsave instead of save
- 用法：`opencli reddit save [options] -f json`

### saved
- 用途：Browse your saved Reddit posts
- 参数：
  - `limit`（可选）：类型 int；默认值 15
- 用法：`opencli reddit saved [options] -f json`

### search
- 用途：Search Reddit Posts
- 参数：
  - `query`（必填）：类型 string
  - `subreddit`（可选）：类型 string；默认值 ""；"Search within a specific subreddit"
  - `sort`（可选）：类型 string；默认值 relevance；"Sort order: relevance, hot, top, new, comments"
  - `time`（可选）：类型 string；默认值 all；"Time filter: hour, day, week, month, year, all"
  - `limit`（可选）：类型 int；默认值 15
- 用法：`opencli reddit search [options] -f json`

### subreddit
- 用途：Get posts from a specific Subreddit
- 参数：
  - `name`（必填）：类型 string
  - `sort`（可选）：类型 string；默认值 hot；"Sorting method: hot, new, top, rising, controversial"
  - `time`（可选）：类型 string；默认值 all；"Time filter for top/controversial: hour, day, week, month, year, all"
  - `limit`（可选）：类型 int；默认值 15
- 用法：`opencli reddit subreddit [options] -f json`

### subscribe
- 用途：Subscribe or unsubscribe to a subreddit
- 参数：
  - `subreddit`（必填）：类型 string；Subreddit name (e.g. python)
  - `undo`（可选）：类型 boolean；默认值 false；Unsubscribe instead of subscribe
- 用法：`opencli reddit subscribe [options] -f json`

### upvote
- 用途：Upvote or downvote a Reddit post
- 参数：
  - `post-id`（必填）：类型 string；Post ID (e.g. 1abc123) or fullname (t3_xxx)
  - `direction`（可选）：类型 string；默认值 'up'；Vote direction: up, down, none
- 用法：`opencli reddit upvote [options] -f json`

### upvoted
- 用途：Browse your upvoted Reddit posts
- 参数：
  - `limit`（可选）：类型 int；默认值 15
- 用法：`opencli reddit upvoted [options] -f json`

### user
- 用途：View a Reddit user profile
- 参数：
  - `username`（必填）：类型 string
- 用法：`opencli reddit user [options] -f json`

### user-comments
- 用途：View a Reddit user's comment history
- 参数：
  - `username`（必填）：类型 string
  - `limit`（可选）：类型 int；默认值 15
- 用法：`opencli reddit user-comments [options] -f json`

### user-posts
- 用途：View a Reddit user's submitted posts
- 参数：
  - `username`（必填）：类型 string
  - `limit`（可选）：类型 int；默认值 15
- 用法：`opencli reddit user-posts [options] -f json`
