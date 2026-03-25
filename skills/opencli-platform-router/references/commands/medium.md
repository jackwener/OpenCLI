# medium

## Commands

### feed
- 用途：Medium 热门文章 Feed
- 参数：
  - `topic`（可选）：默认值 ''；话题标签（如 technology, programming, ai）
  - `limit`（可选）：类型 int；默认值 20；返回的文章数量
- 用法：`opencli medium feed [options] -f json`

### search
- 用途：搜索 Medium 文章
- 参数：
  - `keyword`（必填）：搜索关键词
  - `limit`（可选）：类型 int；默认值 20；返回的文章数量
- 用法：`opencli medium search [options] -f json`

### user
- 用途：获取 Medium 用户的文章列表
- 参数：
  - `username`（必填）：Medium 用户名（如 @username 或 username）
  - `limit`（可选）：类型 int；默认值 20；返回的文章数量
- 用法：`opencli medium user [options] -f json`
