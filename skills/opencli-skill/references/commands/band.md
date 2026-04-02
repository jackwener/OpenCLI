# band

## Commands

### bands
- Purpose: List all Bands you belong to
- Args: None
- Usage: `opencli band bands [options] -f json`

### mentions
- Purpose: Show Band notifications where you are @mentioned
- Args:
  - `filter`(optional; default: 'mentioned'); Filter: mentioned (default) | all | post | comment
  - `limit`(optional; type: int; default: 20); Max results
  - `unread`(optional; type: bool; default: false); Show only unread notifications
- Usage: `opencli band mentions [options] -f json`

### post
- Purpose: Export full content of a post including comments
- Args:
  - `band_no`(required; type: int); Band number
  - `post_no`(required; type: int); Post number
  - `output`(optional; type: str; default: ''); Directory to save attached photos
  - `comments`(optional; type: bool; default: true); Include comments (default: true)
- Usage: `opencli band post [options] -f json`

### posts
- Purpose: List posts from a Band
- Args:
  - `band_no`(required; type: int); Band number (get it from: band bands)
  - `limit`(optional; type: int; default: 20); Max results
- Usage: `opencli band posts [options] -f json`
