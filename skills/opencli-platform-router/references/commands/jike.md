# jike

## Commands

### comment
- 用途：评论即刻帖子
- 参数：
  - `id`（必填）：类型 string；帖子 ID
  - `text`（必填）：类型 string；评论内容
- 用法：`opencli jike comment [options] -f json`

### create
- 用途：发布即刻动态
- 参数：
  - `text`（必填）：类型 string；动态正文内容
- 用法：`opencli jike create [options] -f json`

### feed
- 用途：即刻首页动态流
- 参数：
  - `limit`（可选）：类型 int；默认值 20
- 用法：`opencli jike feed [options] -f json`

### like
- 用途：点赞即刻帖子
- 参数：
  - `id`（必填）：类型 string；帖子 ID
- 用法：`opencli jike like [options] -f json`

### notifications
- 用途：即刻通知
- 参数：
  - `limit`（可选）：类型 int；默认值 20
- 用法：`opencli jike notifications [options] -f json`

### post
- 用途：即刻帖子详情及评论
- 参数：
  - `id`（必填）：类型 string；Post ID (from post URL)
- 用法：`opencli jike post [options] -f json`

### repost
- 用途：转发即刻帖子
- 参数：
  - `id`（必填）：类型 string；帖子 ID
  - `text`（可选）：类型 string；转发附言（可选）
- 用法：`opencli jike repost [options] -f json`

### search
- 用途：搜索即刻帖子
- 参数：
  - `query`（必填）：类型 string
  - `limit`（可选）：类型 int；默认值 20
- 用法：`opencli jike search [options] -f json`

### topic
- 用途：即刻话题/圈子帖子
- 参数：
  - `id`（必填）：类型 string；Topic ID (from topic URL, e.g. 553870e8e4b0cafb0a1bef68)
  - `limit`（可选）：类型 int；默认值 20；Number of posts
- 用法：`opencli jike topic [options] -f json`

### user
- 用途：即刻用户动态
- 参数：
  - `username`（必填）：类型 string；Username from profile URL (e.g. wenhao1996)
  - `limit`（可选）：类型 int；默认值 20；Number of posts
- 用法：`opencli jike user [options] -f json`
