# xiaoyuzhou

## Commands

### episode
- 用途：View details of a Xiaoyuzhou podcast episode
- 参数：
  - `id`（必填）：Episode ID (eid from podcast-episodes output)
- 用法：`opencli xiaoyuzhou episode [options] -f json`

### podcast
- 用途：View a Xiaoyuzhou podcast profile
- 参数：
  - `id`（必填）：Podcast ID (from xiaoyuzhoufm.com URL)
- 用法：`opencli xiaoyuzhou podcast [options] -f json`

### podcast-episodes
- 用途：List recent episodes of a Xiaoyuzhou podcast (up to 15, SSR limit)
- 参数：
  - `id`（必填）：Podcast ID (from xiaoyuzhoufm.com URL)
  - `limit`（可选）：类型 int；默认值 15；Max episodes to show (up to 15, SSR limit)
- 用法：`opencli xiaoyuzhou podcast-episodes [options] -f json`
