# pixiv

## Commands

### detail
- Purpose: View illustration details (tags, stats, URLs)
- Args: None
- Usage: `opencli pixiv detail [options] -f json`

### download
- Purpose: Download images from a Pixiv illustration
- Args:
  - `illust-id`(required); Illustration ID
  - `output`(optional; default: './pixiv-downloads'); Output directory
- Usage: `opencli pixiv download [options] -f json`

### illusts
- Purpose: List illustrations by Pixiv artist
- Args:
  - `user-id`(required); Pixiv user ID
  - `limit`(optional; type: int; default: 20); Number of results
- Usage: `opencli pixiv illusts [options] -f json`

### ranking
- Purpose: Get Pixiv illustration rankings
- Args: None
- Usage: `opencli pixiv ranking [options] -f json`

### search
- Purpose: Search Pixiv illustrations by keyword or tag
- Args:
  - `query`(required); Search keyword or tag
  - `limit`(optional; type: int; default: 20); Number of results
  - `order`(optional; type: str; default: 'date_d'); Sort order
  - `mode`(optional; type: str; default: 'all'); Search mode
  - `page`(optional; type: int; default: 1); Page number
- Usage: `opencli pixiv search [options] -f json`

### user
- Purpose: View Pixiv artist profile
- Args: None
- Usage: `opencli pixiv user [options] -f json`
