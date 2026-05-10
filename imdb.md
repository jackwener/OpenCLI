# IMDb

**Mode**: 🌐 Public (Browser) · **Domain**: `www.imdb.com`

## Commands

| Command | Description |
|---------|-------------|
| `opencli imdb search` | Search movies, TV shows, and people |
| `opencli imdb title` | Get movie or TV show details |
| `opencli imdb top` | IMDb Top 250 Movies |
| `opencli imdb trending` | IMDb Most Popular Movies |
| `opencli imdb person` | Get actor or director info |
| `opencli imdb reviews` | Get user reviews for a title |

## Usage Examples

```bash
# Search for a movie
opencli imdb search "inception" --limit 10

# Get movie details
opencli imdb title tt1375666

# Get TV series details (also accepts full URL)
opencli imdb title "https://www.imdb.com/title/tt0903747/"

# Top 250 movies
opencli imdb top --limit 20

# Currently trending movies
opencli imdb trending --limit 10

# Actor/director info with filmography
opencli imdb person nm0634240 --limit 5

# User reviews
opencli imdb reviews tt1375666 --limit 5

# JSON output
opencli imdb top --limit 5 -f json
```

## Prerequisites

- Chrome with Browser Bridge extension installed
- No login required (all data is public)
