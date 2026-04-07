# instagram

## Commands

### comment
- Purpose: Comment on an Instagram post
- Args: None
- Usage: `opencli instagram comment [options] -f json`

### download
- Purpose: Download images and videos from Instagram posts and reels
- Args:
  - `url`(required); Instagram post / reel / tv URL
  - `path`(optional; default: path.join(os.homedir()); Download directory
- Usage: `opencli instagram download [options] -f json`

### explore
- Purpose: Instagram explore/discover trending posts
- Args: None
- Usage: `opencli instagram explore [options] -f json`

### follow
- Purpose: Follow an Instagram user
- Args: None
- Usage: `opencli instagram follow [options] -f json`

### followers
- Purpose: List followers of an Instagram user
- Args: None
- Usage: `opencli instagram followers [options] -f json`

### following
- Purpose: List accounts an Instagram user is following
- Args: None
- Usage: `opencli instagram following [options] -f json`

### like
- Purpose: Like an Instagram post
- Args: None
- Usage: `opencli instagram like [options] -f json`

### note
- Purpose: Publish a text Instagram note
- Args:
  - `content`(required); Note text (max 60 characters)
- Usage: `opencli instagram note [options] -f json`

### post
- Purpose: Post an Instagram feed image or mixed-media carousel
- Args:
  - `media`(optional)
  - `content`(optional); Caption text
- Usage: `opencli instagram post [options] -f json`

### profile
- Purpose: Get Instagram user profile info
- Args: None
- Usage: `opencli instagram profile [options] -f json`

### reel
- Purpose: Post an Instagram reel video
- Args:
  - `video`(optional); Path to a single .mp4 video file
  - `content`(optional); Caption text
- Usage: `opencli instagram reel [options] -f json`

### save
- Purpose: Save (bookmark) an Instagram post
- Args: None
- Usage: `opencli instagram save [options] -f json`

### saved
- Purpose: Get your saved Instagram posts
- Args: None
- Usage: `opencli instagram saved [options] -f json`

### search
- Purpose: Search Instagram users
- Args: None
- Usage: `opencli instagram search [options] -f json`

### story
- Purpose: Post a single Instagram story image or video
- Args:
  - `media`(optional); Path to a single story image or video file
- Usage: `opencli instagram story [options] -f json`

### unfollow
- Purpose: Unfollow an Instagram user
- Args: None
- Usage: `opencli instagram unfollow [options] -f json`

### unlike
- Purpose: Unlike an Instagram post
- Args: None
- Usage: `opencli instagram unlike [options] -f json`

### unsave
- Purpose: Unsave (remove bookmark) an Instagram post
- Args: None
- Usage: `opencli instagram unsave [options] -f json`

### user
- Purpose: Get recent posts from an Instagram user
- Args: None
- Usage: `opencli instagram user [options] -f json`
