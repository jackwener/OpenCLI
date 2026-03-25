# twitter

## Commands

### accept
- 用途：Auto-accept DM requests containing specific keywords
- 参数：
  - `query`（必填）：类型 string；Keywords to match (comma-separated for OR, e.g.
  - `max`（可选）：类型 int；默认值 20；Maximum number of requests to accept (default: 20)
- 用法：`opencli twitter accept [options] -f json`

### article
- 用途：Fetch a Twitter Article (long-form content) and export as Markdown
- 参数：
  - `tweet-id`（必填）：类型 string；Tweet ID or URL containing the article
- 用法：`opencli twitter article [options] -f json`

### block
- 用途：Block a Twitter user
- 参数：
  - `username`（必填）：类型 string；Twitter screen name (without @)
- 用法：`opencli twitter block [options] -f json`

### bookmark
- 用途：Bookmark a tweet
- 参数：
  - `url`（必填）：类型 string；Tweet URL to bookmark
- 用法：`opencli twitter bookmark [options] -f json`

### bookmarks
- 用途：Fetch Twitter/X bookmarks
- 参数：
  - `limit`（可选）：类型 int；默认值 20
- 用法：`opencli twitter bookmarks [options] -f json`

### delete
- 用途：Delete a specific tweet by URL
- 参数：
  - `url`（必填）：类型 string；The URL of the tweet to delete
- 用法：`opencli twitter delete [options] -f json`

### download
- 用途：下载 Twitter/X 媒体（图片和视频）
- 参数：
  - `username`（可选）：Twitter username (downloads from media tab)
  - `tweet-url`（可选）：Single tweet URL to download
  - `limit`（可选）：类型 int；默认值 10；Number of tweets to scan
  - `output`（可选）：默认值 './twitter-downloads'；Output directory
- 用法：`opencli twitter download [options] -f json`

### follow
- 用途：Follow a Twitter user
- 参数：
  - `username`（必填）：类型 string；Twitter screen name (without @)
- 用法：`opencli twitter follow [options] -f json`

### followers
- 用途：Get accounts following a Twitter/X user
- 参数：
  - `user`（可选）：类型 string
  - `limit`（可选）：类型 int；默认值 50
- 用法：`opencli twitter followers [options] -f json`

### following
- 用途：Get accounts a Twitter/X user is following
- 参数：
  - `user`（可选）：类型 string
  - `limit`（可选）：类型 int；默认值 50
- 用法：`opencli twitter following [options] -f json`

### hide-reply
- 用途：Hide a reply on your tweet (useful for hiding bot/spam replies)
- 参数：
  - `url`（必填）：类型 string；The URL of the reply tweet to hide
- 用法：`opencli twitter hide-reply [options] -f json`

### like
- 用途：Like a specific tweet
- 参数：
  - `url`（必填）：类型 string；The URL of the tweet to like
- 用法：`opencli twitter like [options] -f json`

### notifications
- 用途：Get Twitter/X notifications
- 参数：
  - `limit`（可选）：类型 int；默认值 20
- 用法：`opencli twitter notifications [options] -f json`

### post
- 用途：Post a new tweet/thread
- 参数：
  - `text`（必填）：类型 string；The text content of the tweet
- 用法：`opencli twitter post [options] -f json`

### profile
- 用途：Fetch a Twitter user profile (bio, stats, etc.)
- 参数：
  - `username`（可选）：类型 string；Twitter screen name (without @). Defaults to logged-in user.
- 用法：`opencli twitter profile [options] -f json`

### reply
- 用途：Reply to a specific tweet
- 参数：
  - `url`（必填）：类型 string；The URL of the tweet to reply to
  - `text`（必填）：类型 string；The text content of your reply
- 用法：`opencli twitter reply [options] -f json`

### reply-dm
- 用途：Send a message to recent DM conversations
- 参数：
  - `text`（必填）：类型 string；Message text to send (e.g.
  - `max`（可选）：类型 int；默认值 20；Maximum number of conversations to reply to (default: 20)
  - `skip-replied`（可选）：类型 boolean；默认值 true；Skip conversations where you already sent the same text (default: true)
- 用法：`opencli twitter reply-dm [options] -f json`

### search
- 用途：Search Twitter/X for tweets
- 参数：
  - `query`（必填）：类型 string
  - `limit`（可选）：类型 int；默认值 15
- 用法：`opencli twitter search [options] -f json`

### thread
- 用途：Get a tweet thread (original + all replies)
- 参数：
  - `tweet-id`（必填）：类型 string
  - `limit`（可选）：类型 int；默认值 50
- 用法：`opencli twitter thread [options] -f json`

### timeline
- 用途：Fetch Twitter timeline (for-you or following)
- 参数：
  - `type`（可选）：默认值 'for-you'；Timeline type: for-you (algorithmic) or following (chronological)
  - `limit`（可选）：类型 int；默认值 20
- 用法：`opencli twitter timeline [options] -f json`

### trending
- 用途：Twitter/X trending topics
- 参数：
  - `limit`（可选）：类型 int；默认值 20；Number of trends to show
- 用法：`opencli twitter trending [options] -f json`

### unblock
- 用途：Unblock a Twitter user
- 参数：
  - `username`（必填）：类型 string；Twitter screen name (without @)
- 用法：`opencli twitter unblock [options] -f json`

### unbookmark
- 用途：Remove a tweet from bookmarks
- 参数：
  - `url`（必填）：类型 string；Tweet URL to unbookmark
- 用法：`opencli twitter unbookmark [options] -f json`

### unfollow
- 用途：Unfollow a Twitter user
- 参数：
  - `username`（必填）：类型 string；Twitter screen name (without @)
- 用法：`opencli twitter unfollow [options] -f json`
