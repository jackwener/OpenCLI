# google

## Commands

### news
- 用途：Get Google News headlines
- 参数：
  - `keyword`（可选）：Search query (omit for top stories)
  - `limit`（可选）：类型 int；默认值 10；Number of results
  - `lang`（可选）：默认值 'en'；Language short code (e.g. en, zh)
  - `region`（可选）：默认值 'US'；Region code (e.g. US, CN)
- 用法：`opencli google news [options] -f json`

### search
- 用途：Search Google
- 参数：
  - `keyword`（必填）：Search query
  - `limit`（可选）：类型 int；默认值 10；Number of results (1-100)
  - `lang`（可选）：默认值 'en'；Language short code (e.g. en, zh)
- 用法：`opencli google search [options] -f json`

### suggest
- 用途：Get Google search suggestions
- 参数：
  - `keyword`（必填）：Search query
  - `lang`（可选）：默认值 'zh-CN'；Language code
- 用法：`opencli google suggest [options] -f json`

### trends
- 用途：Get Google Trends daily trending searches
- 参数：
  - `region`（可选）：默认值 'US'；Region code (e.g. US, CN, JP)
  - `limit`（可选）：类型 int；默认值 20；Number of results
- 用法：`opencli google trends [options] -f json`
