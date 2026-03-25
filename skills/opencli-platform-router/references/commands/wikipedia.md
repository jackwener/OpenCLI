# wikipedia

## Commands

### random
- 用途：Get a random Wikipedia article
- 参数：
  - `lang`（可选）：默认值 'en'；Language code (e.g. en, zh, ja)
- 用法：`opencli wikipedia random [options] -f json`

### search
- 用途：Search Wikipedia articles
- 参数：
  - `query`（必填）：Search keyword
  - `limit`（可选）：类型 int；默认值 10；Max results
  - `lang`（可选）：默认值 'en'；Language code (e.g. en, zh, ja)
- 用法：`opencli wikipedia search [options] -f json`

### summary
- 用途：Get Wikipedia article summary
- 参数：
  - `title`（必填）：Article title (e.g.
  - `lang`（可选）：默认值 'en'；Language code (e.g. en, zh, ja)
- 用法：`opencli wikipedia summary [options] -f json`

### trending
- 用途：Most-read Wikipedia articles (yesterday)
- 参数：
  - `limit`（可选）：类型 int；默认值 10；Max results
  - `lang`（可选）：默认值 'en'；Language code (e.g. en, zh, ja)
- 用法：`opencli wikipedia trending [options] -f json`
