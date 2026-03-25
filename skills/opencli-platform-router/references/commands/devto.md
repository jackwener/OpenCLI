# devto

## Commands

### tag
- 用途：Latest DEV.to articles for a specific tag
- 参数：
  - `tag`（必填）：类型 str；"Tag name (e.g. javascript, python, webdev)"
  - `limit`（可选）：类型 int；默认值 20；Number of articles
- 用法：`opencli devto tag [options] -f json`

### top
- 用途：Top DEV.to articles of the day
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of articles
- 用法：`opencli devto top [options] -f json`

### user
- 用途：Recent DEV.to articles from a specific user
- 参数：
  - `username`（必填）：类型 str；"DEV.to username (e.g. ben, thepracticaldev)"
  - `limit`（可选）：类型 int；默认值 20；Number of articles
- 用法：`opencli devto user [options] -f json`
