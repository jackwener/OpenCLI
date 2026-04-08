# bilibili

## Commands

### comments
- Purpose: 获取 B站视频评论（使用官方 API + WBI 签名）
- Args:
  - `bvid`(required); Video BV ID (e.g. BV1WtAGzYEBm)
  - `limit`(optional; type: int; default: 20); Number of comments (max 50)
- Usage: `opencli bilibili comments [options] -f json`

### download
- Purpose: Download Bilibili video (requires yt-dlp)
- Args:
  - `bvid`(required); Video BV ID (e.g., BV1xxx)
  - `output`(optional; default: './bilibili-downloads'); Output directory
  - `quality`(optional; default: 'best'); Video quality (best, 1080p, 720p, 480p)
- Usage: `opencli bilibili download [options] -f json`

### dynamic
- Purpose: Get Bilibili user dynamic feed
- Args:
  - `limit`(optional; type: int; default: 15)
- Usage: `opencli bilibili dynamic [options] -f json`

### favorite
- Purpose: My default favorites folder
- Args:
  - `limit`(optional; type: int; default: 20); Number of results
  - `page`(optional; type: int; default: 1); Page number
- Usage: `opencli bilibili favorite [options] -f json`

### feed
- Purpose: Following feed timeline
- Args:
  - `limit`(optional; type: int; default: 20); Number of results
  - `type`(optional; default: 'all'); Filter: all, video, article
- Usage: `opencli bilibili feed [options] -f json`

### following
- Purpose: Get a Bilibili user's following list
- Args:
  - `uid`(optional); 目标用户 ID（默认为当前登录用户）
  - `page`(optional; type: int; default: 1); 页码
  - `limit`(optional; type: int; default: 50); 每页数量 (最大 50)
- Usage: `opencli bilibili following [options] -f json`

### history
- Purpose: My watch history
- Args:
  - `limit`(optional; type: int; default: 20); Number of results
- Usage: `opencli bilibili history [options] -f json`

### hot
- Purpose: Bilibili hot videos
- Args: None
- Usage: `opencli bilibili hot [options] -f json`

### me
- Purpose: My Bilibili profile info
- Args: None
- Usage: `opencli bilibili me [options] -f json`

### ranking
- Purpose: Get Bilibili video ranking board
- Args:
  - `limit`(optional; type: int; default: 20)
- Usage: `opencli bilibili ranking [options] -f json`

### search
- Purpose: Search Bilibili videos or users
- Args:
  - `query`(required); Search keyword
  - `type`(optional; default: 'video'); video or user
  - `page`(optional; type: int; default: 1); Result page
  - `limit`(optional; type: int; default: 20); Number of results
- Usage: `opencli bilibili search [options] -f json`

### subtitle
- Purpose: Get subtitles for a Bilibili video
- Args:
  - `bvid`(required)
  - `lang`(optional); 字幕语言代码 (如 zh-CN, en-US, ai-zh)，默认取第一个
- Usage: `opencli bilibili subtitle [options] -f json`

### user-videos
- Purpose: List videos posted by a specific user
- Args:
  - `uid`(required); User UID or username
  - `limit`(optional; type: int; default: 20); Number of results
  - `order`(optional; default: 'pubdate'); Sort: pubdate, click, stow
  - `page`(optional; type: int; default: 1); Page number
- Usage: `opencli bilibili user-videos [options] -f json`
