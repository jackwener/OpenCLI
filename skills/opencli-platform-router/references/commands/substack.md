# substack

## Commands

### feed
- 用途：Substack 热门文章 Feed
- 参数：
  - `category`（可选）：默认值 'all'；文章分类: all, tech, business, culture, politics, science, health
  - `limit`（可选）：类型 int；默认值 20；返回的文章数量
- 用法：`opencli substack feed [options] -f json`

### publication
- 用途：获取特定 Substack Newsletter 的最新文章
- 参数：
  - `url`（必填）：Newsletter URL（如 https://example.substack.com）
  - `limit`（可选）：类型 int；默认值 20；返回的文章数量
- 用法：`opencli substack publication [options] -f json`

### search
- 用途：搜索 Substack 文章和 Newsletter
- 参数：
  - `keyword`（必填）：搜索关键词
  - `type`（可选）：默认值 'posts'；搜索类型（posts=文章, publications=Newsletter）
  - `limit`（可选）：类型 int；默认值 20；返回结果数量
- 用法：`opencli substack search [options] -f json`
