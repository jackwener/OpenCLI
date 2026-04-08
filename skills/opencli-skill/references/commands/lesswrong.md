# lesswrong

## Commands

### _helpers
- Purpose: lesswrong _helpers operation
- Args: None
- Usage: `opencli lesswrong _helpers [options] -f json`

### comments
- Purpose: Top comments on a post
- Args:
  - `url-or-id`(required; type: string); Post URL or LessWrong post ID
  - `limit`(optional; type: int; default: 5); Number of comments
- Usage: `opencli lesswrong comments [options] -f json`

### curated
- Purpose: Curated editor's picks
- Args:
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong curated [options] -f json`

### frontpage
- Purpose: Algorithmic frontpage
- Args:
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong frontpage [options] -f json`

### new
- Purpose: Latest posts
- Args:
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong new [options] -f json`

### read
- Purpose: Read full post by URL or ID
- Args:
  - `url-or-id`(required; type: string); Post URL or LessWrong post ID
- Usage: `opencli lesswrong read [options] -f json`

### sequences
- Purpose: List post collections
- Args:
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong sequences [options] -f json`

### shortform
- Purpose: Quick takes / shortform posts
- Args:
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong shortform [options] -f json`

### tag
- Purpose: Posts by tag
- Args:
  - `tag`(required; type: string); Tag slug or name
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong tag [options] -f json`

### tags
- Purpose: List popular tags
- Args:
  - `limit`(optional; type: int; default: 20); Number of results
- Usage: `opencli lesswrong tags [options] -f json`

### top
- Purpose: Top all-time
- Args:
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong top [options] -f json`

### top-month
- Purpose: Top this month
- Args:
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong top-month [options] -f json`

### top-week
- Purpose: Top this week
- Args:
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong top-week [options] -f json`

### top-year
- Purpose: Top this year
- Args:
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong top-year [options] -f json`

### user
- Purpose: User profile
- Args:
  - `username`(required; type: string); LessWrong username or slug
- Usage: `opencli lesswrong user [options] -f json`

### user-posts
- Purpose: List a user's posts
- Args:
  - `username`(required; type: string); LessWrong username or slug
  - `limit`(optional; type: int; default: 10); Number of results
- Usage: `opencli lesswrong user-posts [options] -f json`
