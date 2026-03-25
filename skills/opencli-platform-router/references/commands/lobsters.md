# lobsters

## Commands

### active
- 用途：Lobste.rs most active discussions
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of stories
- 用法：`opencli lobsters active [options] -f json`

### hot
- 用途：Lobste.rs hottest stories
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of stories
- 用法：`opencli lobsters hot [options] -f json`

### newest
- 用途：Lobste.rs newest stories
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of stories
- 用法：`opencli lobsters newest [options] -f json`

### tag
- 用途：Lobste.rs stories by tag
- 参数：
  - `tag`（必填）：类型 str；"Tag name (e.g. programming, rust, security, ai)"
  - `limit`（可选）：类型 int；默认值 20；Number of stories
- 用法：`opencli lobsters tag [options] -f json`
