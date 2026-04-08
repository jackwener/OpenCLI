# apple-podcasts

## Commands

### episodes
- Purpose: List recent episodes of an Apple Podcast (use ID from search)
- Args:
  - `id`(required); Podcast ID (collectionId from search output)
  - `limit`(optional; type: int; default: 15); Max episodes to show
- Usage: `opencli apple-podcasts episodes [options] -f json`

### search
- Purpose: Search Apple Podcasts
- Args:
  - `query`(required); Search keyword
  - `limit`(optional; type: int; default: 10); Max results
- Usage: `opencli apple-podcasts search [options] -f json`

### top
- Purpose: Top podcasts chart on Apple Podcasts
- Args:
  - `limit`(optional; type: int; default: 20); Number of podcasts (max 100)
  - `country`(optional; default: 'us'); Country code (e.g. us, cn, gb, jp)
- Usage: `opencli apple-podcasts top [options] -f json`
