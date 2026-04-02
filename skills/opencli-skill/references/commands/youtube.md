# youtube

## Commands

### channel
- Purpose: Get YouTube channel info and recent videos
- Args:
  - `id`(required); Channel ID (UCxxxx) or handle (@name)
  - `limit`(optional; type: int; default: 10); Max recent videos (max 30)
- Usage: `opencli youtube channel [options] -f json`

### comments
- Purpose: Get YouTube video comments
- Args:
  - `url`(required); YouTube video URL or video ID
  - `limit`(optional; type: int; default: 20); Max comments (max 100)
- Usage: `opencli youtube comments [options] -f json`

### search
- Purpose: Search YouTube videos
- Args:
  - `query`(required); Search query
  - `limit`(optional; type: int; default: 20); Max results (max 50)
  - `type`(optional; default: ''); Filter type: shorts, video, channel, playlist
  - `upload`(optional; default: ''); Upload date: hour, today, week, month, year
  - `sort`(optional; default: ''); Sort by: relevance, date, views, rating
- Usage: `opencli youtube search [options] -f json`

### transcript
- Purpose: Get YouTube video transcript/subtitles
- Args: None
- Usage: `opencli youtube transcript [options] -f json`

### transcript-group
- Purpose: youtube transcript-group operation
- Args: None
- Usage: `opencli youtube transcript-group [options] -f json`

### video
- Purpose: Get YouTube video metadata (title, views, description, etc.)
- Args:
  - `url`(required); YouTube video URL or video ID
- Usage: `opencli youtube video [options] -f json`
