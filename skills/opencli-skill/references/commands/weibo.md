# weibo

## Commands

### comments
- Purpose: Get comments on a Weibo post
- Args:
  - `id`(required); Post ID (numeric idstr)
  - `limit`(optional; type: int; default: 20); Number of comments (max 50)
- Usage: `opencli weibo comments [options] -f json`

### feed
- Purpose: Weibo home timeline (posts from followed users)
- Args:
  - `limit`(optional; type: int; default: 15); Number of posts (max 50)
- Usage: `opencli weibo feed [options] -f json`

### hot
- Purpose: Weibo trending topics
- Args:
  - `limit`(optional; type: int; default: 30); Number of items (max 50)
- Usage: `opencli weibo hot [options] -f json`

### me
- Purpose: My Weibo profile info
- Args: None
- Usage: `opencli weibo me [options] -f json`

### post
- Purpose: Get a single Weibo post
- Args:
  - `id`(required); Post ID (numeric idstr or mblogid from URL)
- Usage: `opencli weibo post [options] -f json`

### search
- Purpose: Search Weibo
- Args:
  - `keyword`(required); Search keyword
  - `limit`(optional; type: int; default: 10); Number of results (max 50)
- Usage: `opencli weibo search [options] -f json`

### user
- Purpose: Get Weibo user profile
- Args:
  - `id`(required); User ID (numeric uid) or screen name
- Usage: `opencli weibo user [options] -f json`
