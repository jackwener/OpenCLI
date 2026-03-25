# linux-do

## Commands

### categories
- 用途：linux.do 分类列表
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of categories
- 用法：`opencli linux-do categories [options] -f json`

### category
- 用途：linux.do 分类内话题
- 参数：
  - `slug`（必填）：类型 str；Category slug (use 'categories' command to find)
  - `id`（必填）：类型 int；Category ID (use 'categories' command to find)
  - `limit`（可选）：类型 int；默认值 20；Number of topics
- 用法：`opencli linux-do category [options] -f json`

### hot
- 用途：linux.do 热门话题
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of topics
  - `period`（可选）：类型 str；默认值 weekly；Time period
- 用法：`opencli linux-do hot [options] -f json`

### latest
- 用途：linux.do 最新话题
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of topics
- 用法：`opencli linux-do latest [options] -f json`

### search
- 用途：搜索 linux.do
- 参数：
  - `query`（必填）：类型 str；Search query
  - `limit`（可选）：类型 int；默认值 20；Number of results
- 用法：`opencli linux-do search [options] -f json`

### topic
- 用途：linux.do 帖子详情和回复（首页）
- 参数：
  - `id`（必填）：类型 int；Topic ID
- 用法：`opencli linux-do topic [options] -f json`
