# hf

## Commands

### top
- 用途：Top upvoted Hugging Face papers
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of papers
  - `all`（可选）：类型 bool；默认值 false；Return all papers (ignore limit)
  - `date`（可选）：类型 str；Date (YYYY-MM-DD), defaults to most recent
  - `period`（可选）：类型 str；默认值 'daily'；Time period: daily, weekly, or monthly
- 用法：`opencli hf top [options] -f json`
