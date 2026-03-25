# facebook

## Commands

### add-friend
- 用途：Send a friend request on Facebook
- 参数：
  - `username`（必填）：类型 str；Facebook username or profile URL
- 用法：`opencli facebook add-friend [options] -f json`

### events
- 用途：Browse Facebook event categories
- 参数：
  - `limit`（可选）：类型 int；默认值 15；Number of categories
- 用法：`opencli facebook events [options] -f json`

### feed
- 用途：Get your Facebook news feed
- 参数：
  - `limit`（可选）：类型 int；默认值 10；Number of posts
- 用法：`opencli facebook feed [options] -f json`

### friends
- 用途：Get Facebook friend suggestions
- 参数：
  - `limit`（可选）：类型 int；默认值 10；Number of friend suggestions
- 用法：`opencli facebook friends [options] -f json`

### groups
- 用途：List your Facebook groups
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of groups
- 用法：`opencli facebook groups [options] -f json`

### join-group
- 用途：Join a Facebook group
- 参数：
  - `group`（必填）：类型 str；Group ID or URL path (e.g. '1876150192925481' or group name)
- 用法：`opencli facebook join-group [options] -f json`

### memories
- 用途：Get your Facebook memories (On This Day)
- 参数：
  - `limit`（可选）：类型 int；默认值 10；Number of memories
- 用法：`opencli facebook memories [options] -f json`

### notifications
- 用途：Get recent Facebook notifications
- 参数：
  - `limit`（可选）：类型 int；默认值 15；Number of notifications
- 用法：`opencli facebook notifications [options] -f json`

### profile
- 用途：Get Facebook user/page profile info
- 参数：
  - `username`（必填）：类型 str；Facebook username or page name
- 用法：`opencli facebook profile [options] -f json`

### search
- 用途：Search Facebook for people, pages, or posts
- 参数：
  - `query`（必填）：类型 str；Search query
  - `limit`（可选）：类型 int；默认值 10；Number of results
- 用法：`opencli facebook search [options] -f json`
