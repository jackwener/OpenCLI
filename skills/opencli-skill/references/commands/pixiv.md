# pixiv

## Commands

### ranking
- Purpose: Get Pixiv illustration rankings
- Args:
  - `mode`(optional): type: str; default: daily; daily/weekly/monthly/rookie/original/male/female/daily_r18/weekly_r18
  - `page`(optional): type: int; default: 1; Page number
  - `limit`(optional): type: int; default: 20; Number of results
- Usage: `opencli pixiv ranking [options] -f json`

### search
- Purpose: Search Pixiv illustrations by keyword or tag
- Args:
  - `query`(required): Search keyword or tag
  - `limit`(optional): type: int; default: 20; Number of results
  - `order`(optional): type: str; default: date_d; date_d/date/popular_d/popular_male_d/popular_female_d
  - `mode`(optional): type: str; default: all; all/safe/r18
  - `page`(optional): type: int; default: 1; Page number
- Usage: `opencli pixiv search [options] -f json`

### user
- Purpose: View Pixiv artist profile
- Args:
  - `uid`(required): Pixiv user ID
- Usage: `opencli pixiv user [options] -f json`

### illusts
- Purpose: List illustrations by Pixiv artist
- Args:
  - `user-id`(required): Pixiv user ID
  - `limit`(optional): type: int; default: 20; Number of results
- Usage: `opencli pixiv illusts [options] -f json`

### detail
- Purpose: View illustration details (tags, stats, URLs)
- Args:
  - `id`(required): Illustration ID
- Usage: `opencli pixiv detail [options] -f json`

### download
- Purpose: Download images from a Pixiv illustration
- Args:
  - `illust-id`(required): Illustration ID
  - `output`(optional): default: './pixiv-downloads'; Output directory
- Usage: `opencli pixiv download [options] -f json`
