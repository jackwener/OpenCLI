# bloomberg

## Commands

### businessweek
- Purpose: Bloomberg Businessweek top stories (RSS)
- Args:
  - `limit`(optional; type: int; default: 1); Number of feed items to return (max 20)
- Usage: `opencli bloomberg businessweek [options] -f json`

### economics
- Purpose: Bloomberg Economics top stories (RSS)
- Args:
  - `limit`(optional; type: int; default: 1); Number of feed items to return (max 20)
- Usage: `opencli bloomberg economics [options] -f json`

### feeds
- Purpose: List the Bloomberg RSS feed aliases used by the adapter
- Args: None
- Usage: `opencli bloomberg feeds [options] -f json`

### industries
- Purpose: Bloomberg Industries top stories (RSS)
- Args:
  - `limit`(optional; type: int; default: 1); Number of feed items to return (max 20)
- Usage: `opencli bloomberg industries [options] -f json`

### main
- Purpose: Bloomberg homepage top stories (RSS)
- Args:
  - `limit`(optional; type: int; default: 1); Number of feed items to return (max 20)
- Usage: `opencli bloomberg main [options] -f json`

### markets
- Purpose: Bloomberg Markets top stories (RSS)
- Args:
  - `limit`(optional; type: int; default: 1); Number of feed items to return (max 20)
- Usage: `opencli bloomberg markets [options] -f json`

### news
- Purpose: Read a Bloomberg story/article page and return title, full content, and media links
- Args:
  - `link`(required); Bloomberg story/article URL or relative Bloomberg path
- Usage: `opencli bloomberg news [options] -f json`

### opinions
- Purpose: Bloomberg Opinion top stories (RSS)
- Args:
  - `limit`(optional; type: int; default: 1); Number of feed items to return (max 20)
- Usage: `opencli bloomberg opinions [options] -f json`

### politics
- Purpose: Bloomberg Politics top stories (RSS)
- Args:
  - `limit`(optional; type: int; default: 1); Number of feed items to return (max 20)
- Usage: `opencli bloomberg politics [options] -f json`

### tech
- Purpose: Bloomberg Tech top stories (RSS)
- Args:
  - `limit`(optional; type: int; default: 1); Number of feed items to return (max 20)
- Usage: `opencli bloomberg tech [options] -f json`
