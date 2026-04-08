# xiaoyuzhou

## Commands

### episode
- Purpose: View details of a Xiaoyuzhou podcast episode
- Args:
  - `id`(required); Episode ID (eid from podcast-episodes output)
- Usage: `opencli xiaoyuzhou episode [options] -f json`

### podcast
- Purpose: View a Xiaoyuzhou podcast profile
- Args:
  - `id`(required); Podcast ID (from xiaoyuzhoufm.com URL)
- Usage: `opencli xiaoyuzhou podcast [options] -f json`

### podcast-episodes
- Purpose: List recent episodes of a Xiaoyuzhou podcast (up to 15, SSR limit)
- Args:
  - `id`(required); Podcast ID (from xiaoyuzhoufm.com URL)
  - `limit`(optional; type: int; default: 15); Max episodes to show (up to 15, SSR limit)
- Usage: `opencli xiaoyuzhou podcast-episodes [options] -f json`
