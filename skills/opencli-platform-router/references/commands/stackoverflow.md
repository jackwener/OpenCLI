# stackoverflow

## Commands

### bounties
- 用途：Active bounties on Stack Overflow
- 参数：
  - `limit`（可选）：类型 int；默认值 10；Max number of results
- 用法：`opencli stackoverflow bounties [options] -f json`

### hot
- 用途：Hot Stack Overflow questions
- 参数：
  - `limit`（可选）：类型 int；默认值 10；Max number of results
- 用法：`opencli stackoverflow hot [options] -f json`

### search
- 用途：Search Stack Overflow questions
- 参数：
  - `query`（必填）：类型 string；Search query
  - `limit`（可选）：类型 int；默认值 10；Max number of results
- 用法：`opencli stackoverflow search [options] -f json`

### unanswered
- 用途：Top voted unanswered questions on Stack Overflow
- 参数：
  - `limit`（可选）：类型 int；默认值 10；Max number of results
- 用法：`opencli stackoverflow unanswered [options] -f json`
