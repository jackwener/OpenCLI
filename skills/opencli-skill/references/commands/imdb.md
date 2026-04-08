# imdb

## Commands

### person
- Purpose: Get actor or director info
- Args:
  - `id`(required); IMDb person ID (nm0634240) or URL
  - `limit`(optional; type: int; default: 10); Max filmography entries
- Usage: `opencli imdb person [options] -f json`

### reviews
- Purpose: Get user reviews for a movie or TV show
- Args:
  - `id`(required); IMDb title ID (tt1375666) or URL
  - `limit`(optional; type: int; default: 10); Number of reviews
- Usage: `opencli imdb reviews [options] -f json`

### search
- Purpose: Search IMDb for movies, TV shows, and people
- Args:
  - `query`(required); Search query
  - `limit`(optional; type: int; default: 20); Number of results
- Usage: `opencli imdb search [options] -f json`

### title
- Purpose: Get movie or TV show details
- Args:
  - `id`(required); IMDb title ID (tt1375666) or URL
- Usage: `opencli imdb title [options] -f json`

### top
- Purpose: IMDb Top 250 Movies
- Args:
  - `limit`(optional; type: int; default: 20); Number of results
- Usage: `opencli imdb top [options] -f json`

### trending
- Purpose: IMDb Most Popular Movies
- Args:
  - `limit`(optional; type: int; default: 20); Number of results
- Usage: `opencli imdb trending [options] -f json`
