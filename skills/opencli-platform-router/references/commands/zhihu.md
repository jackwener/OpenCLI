# zhihu

## Commands

### download
- 用途：导出知乎文章为 Markdown 格式
- 参数：
  - `url`（必填）：Article URL (zhuanlan.zhihu.com/p/xxx)
  - `output`（可选）：默认值 './zhihu-articles'；Output directory
  - `download-images`（可选）：类型 boolean；默认值 false；Download images locally
- 用法：`opencli zhihu download [options] -f json`

### hot
- 用途：知乎热榜
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of items to return
- 用法：`opencli zhihu hot [options] -f json`

### question
- 用途：知乎问题详情和回答
- 参数：
  - `id`（必填）：Question ID (numeric)
  - `limit`（可选）：类型 int；默认值 5；Number of answers
- 用法：`opencli zhihu question [options] -f json`

### search
- 用途：知乎搜索
- 参数：
  - `query`（必填）：类型 str；Search query
  - `limit`（可选）：类型 int；默认值 10；Number of results
- 用法：`opencli zhihu search [options] -f json`
