# hupu

## Commands

### detail
- Purpose: 获取虎扑帖子详情 (使用Next.js JSON数据)
- Args:
  - `tid`(required); 帖子ID（9位数字）
  - `replies`(optional; type: boolean; default: false); 是否包含热门回复
- Usage: `opencli hupu detail [options] -f json`

### hot
- Purpose: 虎扑热门帖子
- Args: None
- Usage: `opencli hupu hot [options] -f json`

### like
- Purpose: 点赞虎扑回复 (需要登录)
- Args:
  - `tid`(required); 帖子ID（9位数字）
  - `pid`(required); 回复ID
  - `fid`(required); 板块ID（如278汽车区）
- Usage: `opencli hupu like [options] -f json`

### mentions
- Purpose: 查看虎扑提到我的回复 (需要登录)
- Args:
  - `limit`(optional; type: int; default: 20); 最多返回多少条消息
  - `max_pages`(optional; type: int; default: 3); 最多抓取多少页
  - `page_str`(optional); 分页游标；不传时从第一页开始
- Usage: `opencli hupu mentions [options] -f json`

### reply
- Purpose: 回复虎扑帖子 (需要登录)
- Args:
  - `tid`(required); 帖子ID（9位数字）
  - `topic_id`(required); 板块ID，即接口中的 topicId（如 502 篮球资讯）
  - `text`(required); 回复内容
  - `quote_id`(optional); 被引用回复的 pid；填写后会以“回复某条热门回复”的方式发言
- Usage: `opencli hupu reply [options] -f json`

### search
- Purpose: 搜索虎扑帖子 (使用官方API)
- Args:
  - `query`(required); 搜索关键词
  - `page`(optional; type: int; default: 1); 结果页码
  - `limit`(optional; type: int; default: 20); 返回结果数量
  - `forum`(optional); 板块ID过滤 (可选)
  - `sort`(optional; default: 'general'); 排序方式: general/createtime/replytime/light/reply
- Usage: `opencli hupu search [options] -f json`

### unlike
- Purpose: 取消点赞虎扑回复 (需要登录)
- Args:
  - `tid`(required); 帖子ID（9位数字）
  - `pid`(required); 回复ID
  - `fid`(required); 板块ID（如278汽车区）
- Usage: `opencli hupu unlike [options] -f json`
