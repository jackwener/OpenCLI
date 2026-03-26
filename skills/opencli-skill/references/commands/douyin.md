# douyin

## Commands

### profile
- Purpose: Get creator account profile information
- Args: None
- Usage: `opencli douyin profile [options] -f json`

### videos
- Purpose: Get creator video list
- Args:
  - `limit`(optional): type: int; default: 20; Page size
  - `page`(optional): type: int; default: 1; Page number
  - `status`(optional): default: all; all/published/reviewing/scheduled
- Usage: `opencli douyin videos [options] -f json`

### stats
- Purpose: Get analytics metrics for a specific video
- Args:
  - `aweme_id`(required): Video aweme ID
- Usage: `opencli douyin stats [options] -f json`

### activities
- Purpose: Get official activity list
- Args: None
- Usage: `opencli douyin activities [options] -f json`

### collections
- Purpose: Get creator collections list
- Args:
  - `limit`(optional): type: int; default: 20; Number of collections
- Usage: `opencli douyin collections [options] -f json`

### drafts
- Purpose: Get draft video list
- Args:
  - `limit`(optional): type: int; default: 20; Number of drafts
- Usage: `opencli douyin drafts [options] -f json`

### draft
- Purpose: Upload a video and save it as draft
- Args:
  - `video`(required): Local video file path
  - `title`(required): Video title (<= 30 chars)
  - `caption`(optional): default: ''; Caption text (<= 1000 chars, supports hashtags)
  - `cover`(optional): default: ''; Cover image file path
  - `visibility`(optional): default: public; public/friends/private
- Usage: `opencli douyin draft [options] -f json`

### publish
- Purpose: Upload and schedule a Douyin video post
- Args:
  - `video`(required): Local video file path
  - `title`(required): Video title (<= 30 chars)
  - `schedule`(required): Publish time (ISO8601 or Unix seconds, 2h to 14d later)
  - `caption`(optional): default: ''; Caption text (<= 1000 chars, supports hashtags)
  - `cover`(optional): default: ''; Cover image file path
  - `visibility`(optional): default: public; public/friends/private
  - `allow_download`(optional): type: bool; default: false; Allow downloads
  - `collection`(optional): default: ''; Collection ID
  - `activity`(optional): default: ''; Activity ID
  - `poi_id`(optional): default: ''; Location POI ID
  - `poi_name`(optional): default: ''; Location name
  - `hotspot`(optional): default: ''; Hotspot keyword
  - `no_safety_check`(optional): type: bool; default: false; Skip content safety check
  - `sync_toutiao`(optional): type: bool; default: false; Sync to Toutiao
- Usage: `opencli douyin publish [options] -f json`

### update
- Purpose: Update scheduled publish time or caption of a video
- Args:
  - `aweme_id`(required): Video aweme ID
  - `reschedule`(optional): default: ''; New publish time (ISO8601 or Unix seconds)
  - `caption`(optional): default: ''; New caption text
- Usage: `opencli douyin update [options] -f json`

### delete
- Purpose: Delete a published video
- Args:
  - `aweme_id`(required): Video aweme ID
- Usage: `opencli douyin delete [options] -f json`

### hashtag
- Purpose: Hashtag search, suggestion, or hot topics
- Args:
  - `action`(required): search/suggest/hot
  - `keyword`(optional): default: ''; Keyword for search/hot
  - `cover`(optional): default: ''; Cover URI for suggest
  - `limit`(optional): type: int; default: 10; Number of results
- Usage: `opencli douyin hashtag [options] -f json`

### location
- Purpose: Search POI locations
- Args:
  - `query`(required): Location keyword
  - `limit`(optional): type: int; default: 20; Number of results
- Usage: `opencli douyin location [options] -f json`
