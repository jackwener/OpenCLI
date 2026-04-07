# twitter

## Commands

### accept
- Purpose: Auto-accept DM requests containing specific keywords
- Args:
  - `query`(required; type: string); Keywords to match (comma-separated for OR, e.g. "群,微信")
  - `max`(optional; type: int; default: 20); Maximum number of requests to accept (default: 20)
- Usage: `opencli twitter accept [options] -f json`

### article
- Purpose: Fetch a Twitter Article (long-form content) and export as Markdown
- Args:
  - `tweet-id`(required; type: string); Tweet ID or URL containing the article
- Usage: `opencli twitter article [options] -f json`

### block
- Purpose: Block a Twitter user
- Args:
  - `username`(required; type: string); Twitter screen name (without @)
- Usage: `opencli twitter block [options] -f json`

### bookmark
- Purpose: Bookmark a tweet
- Args:
  - `url`(required; type: string); Tweet URL to bookmark
- Usage: `opencli twitter bookmark [options] -f json`

### bookmarks
- Purpose: Fetch Twitter/X bookmarks
- Args:
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli twitter bookmarks [options] -f json`

### delete
- Purpose: Delete a specific tweet by URL
- Args:
  - `url`(required; type: string); The URL of the tweet to delete
- Usage: `opencli twitter delete [options] -f json`

### download
- Purpose: Download Twitter/X media (images and videos)
- Args:
  - `username`(optional); Twitter username (downloads from media tab)
  - `tweet-url`(optional); Single tweet URL to download
  - `limit`(optional; type: int; default: 10); Number of tweets to scan
  - `output`(optional; default: './twitter-downloads'); Output directory
- Usage: `opencli twitter download [options] -f json`

### follow
- Purpose: Follow a Twitter user
- Args:
  - `username`(required; type: string); Twitter screen name (without @)
- Usage: `opencli twitter follow [options] -f json`

### followers
- Purpose: Get accounts following a Twitter/X user
- Args:
  - `user`(optional; type: string)
  - `limit`(optional; type: int; default: 50)
- Usage: `opencli twitter followers [options] -f json`

### following
- Purpose: Get accounts a Twitter/X user is following
- Args:
  - `user`(optional; type: string)
  - `limit`(optional; type: int; default: 50)
- Usage: `opencli twitter following [options] -f json`

### hide-reply
- Purpose: Hide a reply on your tweet (useful for hiding bot/spam replies)
- Args:
  - `url`(required; type: string); The URL of the reply tweet to hide
- Usage: `opencli twitter hide-reply [options] -f json`

### like
- Purpose: Like a specific tweet
- Args:
  - `url`(required; type: string); The URL of the tweet to like
- Usage: `opencli twitter like [options] -f json`

### likes
- Purpose: Fetch liked tweets of a Twitter user
- Args:
  - `username`(optional; type: string); Twitter screen name (without @). Defaults to logged-in user.
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli twitter likes [options] -f json`

### notifications
- Purpose: Get Twitter/X notifications
- Args:
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli twitter notifications [options] -f json`

### post
- Purpose: Post a new tweet/thread
- Args:
  - `text`(required; type: string); The text content of the tweet
  - `images`(optional; type: string); Image paths, comma-separated, max 4 (jpg/png/gif/webp)
- Usage: `opencli twitter post [options] -f json`

### profile
- Purpose: Fetch a Twitter user profile (bio, stats, etc.)
- Args:
  - `username`(optional; type: string); Twitter screen name (without @). Defaults to logged-in user.
- Usage: `opencli twitter profile [options] -f json`

### reply
- Purpose: Reply to a specific tweet
- Args:
  - `url`(required; type: string); The URL of the tweet to reply to
  - `text`(required; type: string); The text content of your reply
  - `image`(optional); Optional local image path to attach to the reply
  - `image-url`(optional); Optional remote image URL to download and attach to the reply
- Usage: `opencli twitter reply [options] -f json`

### reply-dm
- Purpose: Send a message to recent DM conversations
- Args:
  - `text`(required; type: string); Message text to send (e.g. "我的微信 wxkabi")
  - `max`(optional; type: int; default: 20); Maximum number of conversations to reply to (default: 20)
  - `skip-replied`(optional; type: boolean; default: true); Skip conversations where you already sent the same text (default: true)
- Usage: `opencli twitter reply-dm [options] -f json`

### search
- Purpose: Search Twitter/X for tweets
- Args:
  - `query`(required; type: string)
  - `filter`(optional; type: string; default: 'top')
  - `limit`(optional; type: int; default: 15)
- Usage: `opencli twitter search [options] -f json`

### thread
- Purpose: Get a tweet thread (original + all replies)
- Args:
  - `tweet-id`(required; type: string)
  - `limit`(optional; type: int; default: 50)
- Usage: `opencli twitter thread [options] -f json`

### timeline
- Purpose: Fetch Twitter timeline (for-you or following)
- Args:
  - `type`(optional; default: 'for-you'); Timeline type: for-you (algorithmic) or following (chronological)
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli twitter timeline [options] -f json`

### trending
- Purpose: Twitter/X trending topics
- Args:
  - `limit`(optional; type: int; default: 20); Number of trends to show
- Usage: `opencli twitter trending [options] -f json`

### unblock
- Purpose: Unblock a Twitter user
- Args:
  - `username`(required; type: string); Twitter screen name (without @)
- Usage: `opencli twitter unblock [options] -f json`

### unbookmark
- Purpose: Remove a tweet from bookmarks
- Args:
  - `url`(required; type: string); Tweet URL to unbookmark
- Usage: `opencli twitter unbookmark [options] -f json`

### unfollow
- Purpose: Unfollow a Twitter user
- Args:
  - `username`(required; type: string); Twitter screen name (without @)
- Usage: `opencli twitter unfollow [options] -f json`
