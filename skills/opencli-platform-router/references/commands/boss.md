# boss

## Commands

### batchgreet
- 用途：BOSS直聘批量向推荐候选人发送招呼
- 参数：
  - `job-id`（可选）：默认值 ''；Filter by encrypted job ID (greet all jobs if empty)
  - `limit`（可选）：类型 int；默认值 5；Max candidates to greet
  - `text`（可选）：默认值 ''；Custom greeting message (uses default if empty)
- 用法：`opencli boss batchgreet [options] -f json`

### chatlist
- 用途：BOSS直聘查看聊天列表（招聘端）
- 参数：
  - `page`（可选）：类型 int；默认值 1；Page number
  - `limit`（可选）：类型 int；默认值 20；Number of results
  - `job-id`（可选）：默认值 '0'；Filter by job ID (0=all)
- 用法：`opencli boss chatlist [options] -f json`

### chatmsg
- 用途：BOSS直聘查看与候选人的聊天消息
- 参数：
  - `uid`（必填）：Encrypted UID (from chatlist)
  - `page`（可选）：类型 int；默认值 1；Page number
- 用法：`opencli boss chatmsg [options] -f json`

### detail
- 用途：BOSS直聘查看职位详情
- 参数：
  - `security-id`（必填）：Security ID from search results (securityId field)
- 用法：`opencli boss detail [options] -f json`

### exchange
- 用途：BOSS直聘交换联系方式（请求手机/微信）
- 参数：
  - `uid`（必填）：Encrypted UID of the candidate
  - `type`（可选）：默认值 'phone'；Exchange type: phone or wechat
- 用法：`opencli boss exchange [options] -f json`

### greet
- 用途：BOSS直聘向新候选人发送招呼（开始聊天）
- 参数：
  - `uid`（必填）：Encrypted UID of the candidate (from recommend)
  - `security-id`（必填）：Security ID of the candidate
  - `job-id`（必填）：Encrypted job ID
  - `text`（可选）：默认值 ''；Custom greeting message (uses default template if empty)
- 用法：`opencli boss greet [options] -f json`

### invite
- 用途：BOSS直聘发送面试邀请
- 参数：
  - `uid`（必填）：Encrypted UID of the candidate
  - `time`（必填）：Interview time (e.g. 2025-04-01 14:00)
  - `address`（可选）：默认值 ''；Interview address (uses saved address if empty)
  - `contact`（可选）：默认值 ''；Contact person name (uses saved contact if empty)
- 用法：`opencli boss invite [options] -f json`

### joblist
- 用途：BOSS直聘查看我发布的职位列表
- 参数：无
- 用法：`opencli boss joblist [options] -f json`

### mark
- 用途：BOSS直聘给候选人添加标签
- 参数：
  - `uid`（必填）：Encrypted UID of the candidate
  - `label`（必填）：Label name (新招呼/沟通中/已约面/已获取简历/已交换电话/已交换微信/不合适/收藏) or label ID
  - `remove`（可选）：类型 boolean；默认值 false；Remove the label instead of adding
- 用法：`opencli boss mark [options] -f json`

### recommend
- 用途：BOSS直聘查看推荐候选人（新招呼列表）
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of results to return
- 用法：`opencli boss recommend [options] -f json`

### resume
- 用途：BOSS直聘查看候选人简历（招聘端）
- 参数：
  - `uid`（必填）：Encrypted UID of the candidate (from chatlist)
- 用法：`opencli boss resume [options] -f json`

### search
- 用途：BOSS直聘搜索职位
- 参数：
  - `query`（必填）：Search keyword (e.g. AI agent, 前端)
  - `city`（可选）：默认值 '北京'；City name or code (e.g. 杭州, 上海, 101010100)
  - `experience`（可选）：默认值 ''；Experience: 应届/1年以内/1-3年/3-5年/5-10年/10年以上
  - `degree`（可选）：默认值 ''；Degree: 大专/本科/硕士/博士
  - `salary`（可选）：默认值 ''；Salary: 3K以下/3-5K/5-10K/10-15K/15-20K/20-30K/30-50K/50K以上
  - `industry`（可选）：默认值 ''；Industry code or name (e.g. 100020, 互联网)
  - `page`（可选）：类型 int；默认值 1；Page number
  - `limit`（可选）：类型 int；默认值 15；Number of results
- 用法：`opencli boss search [options] -f json`

### send
- 用途：BOSS直聘发送聊天消息
- 参数：
  - `uid`（必填）：Encrypted UID of the candidate (from chatlist)
  - `text`（必填）：Message text to send
- 用法：`opencli boss send [options] -f json`

### stats
- 用途：BOSS直聘职位数据统计
- 参数：
  - `job-id`（可选）：默认值 ''；Encrypted job ID (show all if empty)
- 用法：`opencli boss stats [options] -f json`
