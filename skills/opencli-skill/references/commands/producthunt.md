# producthunt

## Commands

### browse
- Purpose: Best products in a Product Hunt category
- Args:
  - `category`(required; type: string); Category slug, e.g. vibe-coding, ai-agents, developer-tools
  - `limit`(optional; type: int; default: 20); Number of results (max 50)
- Usage: `opencli producthunt browse [options] -f json`

### hot
- Purpose: Today
- Args:
  - `limit`(optional; type: int; default: 20); Number of results (max 50)
- Usage: `opencli producthunt hot [options] -f json`

### posts
- Purpose: Latest Product Hunt launches (optional category filter)
- Args:
  - `limit`(optional; type: int; default: 20); Number of results (max 50)
  - `category`(optional; type: string; default: '')
- Usage: `opencli producthunt posts [options] -f json`

### today
- Purpose: Today
- Args:
  - `limit`(optional; type: int; default: 20); Max results
- Usage: `opencli producthunt today [options] -f json`
