# weibo

## Commands

### hot
- 用途：微博热搜
- 参数：
  - `limit`（可选）：类型 int；默认值 30；Number of items (max 50)
- 用法：`opencli weibo hot [options] -f json`

### search
- 用途：搜索微博
- 参数：
  - `keyword`（必填）：Search keyword
  - `limit`（可选）：类型 int；默认值 10；Number of results (max 50)
- 用法：`opencli weibo search [options] -f json`
