# v2ex

## Commands

### daily
- 用途：V2EX 每日签到并领取铜币
- 参数：无
- 用法：`opencli v2ex daily [options] -f json`

### hot
- 用途：V2EX 热门话题
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of topics
- 用法：`opencli v2ex hot [options] -f json`

### latest
- 用途：V2EX 最新话题
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of topics
- 用法：`opencli v2ex latest [options] -f json`

### me
- 用途：V2EX 获取个人资料 (余额/未读提醒)
- 参数：无
- 用法：`opencli v2ex me [options] -f json`

### member
- 用途：V2EX 用户资料
- 参数：
  - `username`（必填）：类型 str；Username
- 用法：`opencli v2ex member [options] -f json`

### node
- 用途：V2EX 节点话题列表
- 参数：
  - `name`（必填）：类型 str；Node name (e.g. python, javascript, apple)
  - `limit`（可选）：类型 int；默认值 10；Number of topics (API returns max 20)
- 用法：`opencli v2ex node [options] -f json`

### nodes
- 用途：V2EX 所有节点列表
- 参数：
  - `limit`（可选）：类型 int；默认值 30；Number of nodes
- 用法：`opencli v2ex nodes [options] -f json`

### notifications
- 用途：V2EX 获取提醒 (回复/由于)
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of notifications
- 用法：`opencli v2ex notifications [options] -f json`

### replies
- 用途：V2EX 主题回复列表
- 参数：
  - `id`（必填）：类型 str；Topic ID
  - `limit`（可选）：类型 int；默认值 20；Number of replies
- 用法：`opencli v2ex replies [options] -f json`

### topic
- 用途：V2EX 主题详情和回复
- 参数：
  - `id`（必填）：类型 str；Topic ID
- 用法：`opencli v2ex topic [options] -f json`

### user
- 用途：V2EX 用户发帖列表
- 参数：
  - `username`（必填）：类型 str；Username
  - `limit`（可选）：类型 int；默认值 10；Number of topics (API returns max 20)
- 用法：`opencli v2ex user [options] -f json`
