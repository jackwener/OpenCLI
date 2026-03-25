# apple-podcasts

## Commands

### episodes
- 用途：List recent episodes of an Apple Podcast (use ID from search)
- 参数：
  - `id`（必填）：Podcast ID (collectionId from search output)
  - `limit`（可选）：类型 int；默认值 15；Max episodes to show
- 用法：`opencli apple-podcasts episodes [options] -f json`

### search
- 用途：Search Apple Podcasts
- 参数：
  - `query`（必填）：Search keyword
  - `limit`（可选）：类型 int；默认值 10；Max results
- 用法：`opencli apple-podcasts search [options] -f json`

### top
- 用途：Top podcasts chart on Apple Podcasts
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of podcasts (max 100)
  - `country`（可选）：默认值 'us'；Country code (e.g. us, cn, gb, jp)
- 用法：`opencli apple-podcasts top [options] -f json`
