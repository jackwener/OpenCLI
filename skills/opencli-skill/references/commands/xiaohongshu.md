# xiaohongshu

## Commands

### comments
- Purpose: 获取小红书笔记评论（仅主评论，不含楼中楼）
- Args:
  - `note-id`(required); Note ID or full URL (preserves xsec_token for access)
  - `limit`(optional; type: int; default: 20); Number of top-level comments (max 50)
  - `with-replies`(optional; type: boolean; default: false); Include nested replies (楼中楼)
- Usage: `opencli xiaohongshu comments [options] -f json`

### creator-note-detail
- Purpose: Xiaohongshu single-note analytics detail (note info + engagement metrics + traffic sources + audience profile + trends)
- Args:
  - `note-id`(required; type: string); Note ID (from creator-notes or note-detail page URL)
- Usage: `opencli xiaohongshu creator-note-detail [options] -f json`

### creator-notes
- Purpose: Xiaohongshu creator notes list with per-note metrics (title/date/views/likes/favorites/comments)
- Args:
  - `limit`(optional; type: int; default: 20); Number of notes to return
- Usage: `opencli xiaohongshu creator-notes [options] -f json`

### creator-notes-summary
- Purpose: Batch summary for recent Xiaohongshu notes (list + key metrics)
- Args:
  - `limit`(optional; type: int; default: 3); Number of recent notes to summarize
- Usage: `opencli xiaohongshu creator-notes-summary [options] -f json`

### creator-profile
- Purpose: Xiaohongshu creator profile metrics (followers/following/likes received/creator level)
- Args: None
- Usage: `opencli xiaohongshu creator-profile [options] -f json`

### creator-stats
- Purpose: Xiaohongshu creator analytics overview (views/likes/favorites/comments/shares/follower growth with daily trend)
- Args:
  - `period`(optional; type: string; default: 'seven'); Stats period: seven or thirty
- Usage: `opencli xiaohongshu creator-stats [options] -f json`

### download
- Purpose: Download images and videos from a Xiaohongshu note
- Args:
  - `note-id`(required); Note ID, full URL, or short link
  - `output`(optional; default: './xiaohongshu-downloads'); Output directory
- Usage: `opencli xiaohongshu download [options] -f json`

### feed
- Purpose: Xiaohongshu home recommendation feed (via Pinia Store action)
- Args: None
- Usage: `opencli xiaohongshu feed [options] -f json`

### note
- Purpose: 获取小红书笔记正文和互动数据
- Args:
  - `note-id`(required); Note ID or full URL (preserves xsec_token for access)
- Usage: `opencli xiaohongshu note [options] -f json`

### notifications
- Purpose: Xiaohongshu notifications (mentions/likes/connections)
- Args: None
- Usage: `opencli xiaohongshu notifications [options] -f json`

### publish
- Purpose: Publish Xiaohongshu image-text note (creator center UI automation)
- Args:
  - `title`(required); 笔记标题 (最多20字)
  - `content`(required); 笔记正文
  - `images`(required); 图片路径，逗号分隔，最多9张 (jpg/png/gif/webp)
  - `topics`(optional); 话题标签，逗号分隔，不含 # 号
  - `draft`(optional; type: bool; default: false); 保存为草稿，不直接发布
- Usage: `opencli xiaohongshu publish [options] -f json`

### search
- Purpose: Search Xiaohongshu notes
- Args:
  - `query`(required); Search keyword
  - `limit`(optional; type: int; default: 20); Number of results
- Usage: `opencli xiaohongshu search [options] -f json`

### user
- Purpose: Get public notes from a Xiaohongshu user profile
- Args:
  - `id`(required; type: string); User id or profile URL
  - `limit`(optional; type: int; default: 15); Number of notes to return
- Usage: `opencli xiaohongshu user [options] -f json`
