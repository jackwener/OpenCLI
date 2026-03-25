# hackernews

## Commands

### ask
- 用途：Hacker News Ask HN posts
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of stories
- 用法：`opencli hackernews ask [options] -f json`

### best
- 用途：Hacker News best stories
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of stories
- 用法：`opencli hackernews best [options] -f json`

### jobs
- 用途：Hacker News job postings
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of job postings
- 用法：`opencli hackernews jobs [options] -f json`

### new
- 用途：Hacker News newest stories
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of stories
- 用法：`opencli hackernews new [options] -f json`

### search
- 用途：Search Hacker News stories
- 参数：
  - `query`（必填）：类型 str；Search query
  - `limit`（可选）：类型 int；默认值 20；Number of results
  - `sort`（可选）：类型 str；默认值 relevance；Sort by relevance or date
- 用法：`opencli hackernews search [options] -f json`

### show
- 用途：Hacker News Show HN posts
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of stories
- 用法：`opencli hackernews show [options] -f json`

### top
- 用途：Hacker News top stories
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of stories
- 用法：`opencli hackernews top [options] -f json`

### user
- 用途：Hacker News user profile
- 参数：
  - `username`（必填）：类型 str；HN username
- 用法：`opencli hackernews user [options] -f json`
