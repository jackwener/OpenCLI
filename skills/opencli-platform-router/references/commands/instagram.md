# instagram

## Commands

### comment
- 用途：Comment on an Instagram post
- 参数：
  - `username`（必填）：类型 str；Username of the post author
  - `text`（必填）：类型 str；Comment text
  - `index`（可选）：类型 int；默认值 1；Post index (1 = most recent)
- 用法：`opencli instagram comment [options] -f json`

### explore
- 用途：Instagram explore/discover trending posts
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of posts
- 用法：`opencli instagram explore [options] -f json`

### follow
- 用途：Follow an Instagram user
- 参数：
  - `username`（必填）：类型 str；Instagram username to follow
- 用法：`opencli instagram follow [options] -f json`

### followers
- 用途：List followers of an Instagram user
- 参数：
  - `username`（必填）：类型 str；Instagram username
  - `limit`（可选）：类型 int；默认值 20；Number of followers
- 用法：`opencli instagram followers [options] -f json`

### following
- 用途：List accounts an Instagram user is following
- 参数：
  - `username`（必填）：类型 str；Instagram username
  - `limit`（可选）：类型 int；默认值 20；Number of accounts
- 用法：`opencli instagram following [options] -f json`

### like
- 用途：Like an Instagram post
- 参数：
  - `username`（必填）：类型 str；Username of the post author
  - `index`（可选）：类型 int；默认值 1；Post index (1 = most recent)
- 用法：`opencli instagram like [options] -f json`

### profile
- 用途：Get Instagram user profile info
- 参数：
  - `username`（必填）：类型 str；Instagram username
- 用法：`opencli instagram profile [options] -f json`

### save
- 用途：Save (bookmark) an Instagram post
- 参数：
  - `username`（必填）：类型 str；Username of the post author
  - `index`（可选）：类型 int；默认值 1；Post index (1 = most recent)
- 用法：`opencli instagram save [options] -f json`

### saved
- 用途：Get your saved Instagram posts
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of saved posts
- 用法：`opencli instagram saved [options] -f json`

### search
- 用途：Search Instagram users
- 参数：
  - `query`（必填）：类型 str；Search query
  - `limit`（可选）：类型 int；默认值 10；Number of results
- 用法：`opencli instagram search [options] -f json`

### unfollow
- 用途：Unfollow an Instagram user
- 参数：
  - `username`（必填）：类型 str；Instagram username to unfollow
- 用法：`opencli instagram unfollow [options] -f json`

### unlike
- 用途：Unlike an Instagram post
- 参数：
  - `username`（必填）：类型 str；Username of the post author
  - `index`（可选）：类型 int；默认值 1；Post index (1 = most recent)
- 用法：`opencli instagram unlike [options] -f json`

### unsave
- 用途：Unsave (remove bookmark) an Instagram post
- 参数：
  - `username`（必填）：类型 str；Username of the post author
  - `index`（可选）：类型 int；默认值 1；Post index (1 = most recent)
- 用法：`opencli instagram unsave [options] -f json`

### user
- 用途：Get recent posts from an Instagram user
- 参数：
  - `username`（必填）：类型 str；Instagram username
  - `limit`（可选）：类型 int；默认值 12；Number of posts
- 用法：`opencli instagram user [options] -f json`
