# tiktok

## Commands

### comment
- 用途：Comment on a TikTok video
- 参数：
  - `url`（必填）：类型 str；TikTok video URL
  - `text`（必填）：类型 str；Comment text
- 用法：`opencli tiktok comment [options] -f json`

### explore
- 用途：Get trending TikTok videos from explore page
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of videos
- 用法：`opencli tiktok explore [options] -f json`

### follow
- 用途：Follow a TikTok user
- 参数：
  - `username`（必填）：类型 str；TikTok username (without @)
- 用法：`opencli tiktok follow [options] -f json`

### following
- 用途：List accounts you follow on TikTok
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of accounts
- 用法：`opencli tiktok following [options] -f json`

### friends
- 用途：Get TikTok friend suggestions
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of suggestions
- 用法：`opencli tiktok friends [options] -f json`

### like
- 用途：Like a TikTok video
- 参数：
  - `url`（必填）：类型 str；TikTok video URL
- 用法：`opencli tiktok like [options] -f json`

### live
- 用途：Browse live streams on TikTok
- 参数：
  - `limit`（可选）：类型 int；默认值 10；Number of streams
- 用法：`opencli tiktok live [options] -f json`

### notifications
- 用途：Get TikTok notifications (likes, comments, mentions, followers)
- 参数：
  - `limit`（可选）：类型 int；默认值 15；Number of notifications
  - `type`（可选）：类型 str；默认值 all；Notification type
- 用法：`opencli tiktok notifications [options] -f json`

### profile
- 用途：Get TikTok user profile info
- 参数：
  - `username`（必填）：类型 str；TikTok username (without @)
- 用法：`opencli tiktok profile [options] -f json`

### save
- 用途：Add a TikTok video to Favorites
- 参数：
  - `url`（必填）：类型 str；TikTok video URL
- 用法：`opencli tiktok save [options] -f json`

### search
- 用途：Search TikTok videos
- 参数：
  - `query`（必填）：类型 str；Search query
  - `limit`（可选）：类型 int；默认值 10；Number of results
- 用法：`opencli tiktok search [options] -f json`

### unfollow
- 用途：Unfollow a TikTok user
- 参数：
  - `username`（必填）：类型 str；TikTok username (without @)
- 用法：`opencli tiktok unfollow [options] -f json`

### unlike
- 用途：Unlike a TikTok video
- 参数：
  - `url`（必填）：类型 str；TikTok video URL
- 用法：`opencli tiktok unlike [options] -f json`

### unsave
- 用途：Remove a TikTok video from Favorites
- 参数：
  - `url`（必填）：类型 str；TikTok video URL
- 用法：`opencli tiktok unsave [options] -f json`

### user
- 用途：Get recent videos from a TikTok user
- 参数：
  - `username`（必填）：类型 str；TikTok username (without @)
  - `limit`（可选）：类型 int；默认值 10；Number of videos
- 用法：`opencli tiktok user [options] -f json`
